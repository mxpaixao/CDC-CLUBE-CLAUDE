import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../comum/prisma.service';
import { Relogio } from '../comum/relogio';

const n = (v: unknown) => Number(v ?? 0);

/** Visão geral do painel. Todos os valores em centavos. */
@Injectable()
export class RelatoriosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly relogio: Relogio,
  ) {}

  async visaoGeral(dias = 30) {
    const agora = this.relogio.agora();
    const desde = new Date(agora.getTime() - dias * 86_400_000);
    const d90 = new Date(agora.getTime() - 90 * 86_400_000);

    const [adesoesPeriodo, participantesAtivos, ativos90, vendasPeriodo, indicadas] =
      await Promise.all([
        this.prisma.participante.count({ where: { dataAdesao: { gte: desde } } }),
        this.prisma.participante.count({ where: { status: 'ATIVO' } }),
        this.prisma.participante.count({
          where: { status: 'ATIVO', ultimaCompraEm: { gte: d90 } },
        }),
        this.prisma.venda.aggregate({
          where: {
            dataConfirmacao: { gte: desde },
            OR: [{ compradorPessoaId: { not: null } }, { compradorEmpresaId: { not: null } }],
          },
          _count: { _all: true },
          _sum: { baseCalculoCentavos: true },
        }),
        this.prisma.venda.aggregate({
          where: { dataConfirmacao: { gte: desde }, prestadorIndicadorId: { not: null } },
          _count: { _all: true },
          _sum: { baseCalculoCentavos: true, recompensaCentavos: true },
        }),
      ]);

    // recompra: dos compradores com 1ª compra no período anterior de 90 dias, quantos voltaram em 30/60/90 dias
    const recompra = await this.prisma.$queryRaw<
      { base: bigint; r30: bigint; r60: bigint; r90: bigint }[]
    >(Prisma.sql`
      WITH compras AS (
        SELECT COALESCE("compradorPessoaId", "compradorEmpresaId") AS comprador, "dataConfirmacao" AS data
          FROM venda WHERE status = 'CONFIRMADA' AND COALESCE("compradorPessoaId", "compradorEmpresaId") IS NOT NULL
      ), primeira AS (
        SELECT comprador, MIN(data) AS data FROM compras GROUP BY comprador HAVING MIN(data) BETWEEN ${new Date(agora.getTime() - 180 * 86_400_000)} AND ${d90}
      )
      SELECT COUNT(*) AS base,
             COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM compras c WHERE c.comprador = p.comprador AND c.data > p.data AND c.data <= p.data + interval '30 days')) AS r30,
             COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM compras c WHERE c.comprador = p.comprador AND c.data > p.data AND c.data <= p.data + interval '60 days')) AS r60,
             COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM compras c WHERE c.comprador = p.comprador AND c.data > p.data AND c.data <= p.data + interval '90 days')) AS r90
        FROM primeira p`);

    const fluxo = await this.prisma.$queryRaw<
      { origem: string; tipo: string; total: bigint }[]
    >(Prisma.sql`
      SELECT origem::text, tipo::text, SUM("valorCentavos") AS total FROM lancamento WHERE "criadoEm" >= ${desde} GROUP BY origem, tipo`);
    const soma = (f: (o: string, t: string) => boolean) =>
      fluxo.filter((x) => f(x.origem, x.tipo)).reduce((a, x) => a + n(x.total), 0);

    const passivo = await this.prisma.$queryRaw<{ estado: string; total: bigint }[]>(Prisma.sql`
      SELECT l.estado::text, COALESCE(SUM(x."valorCentavos"), 0) AS total
        FROM lancamento l JOIN lancamento x ON x."loteId" = l.id
       WHERE l."loteId" = l.id AND l.estado IN ('PENDENTE', 'DISPONIVEL')
       GROUP BY l.estado`);
    const devedor = await this.prisma.lancamento.aggregate({
      where: { loteId: null },
      _sum: { valorCentavos: true },
    });

    const [alertasMargem, alertasAbertos, divergenciasAbertas, prestadoresPendentes] =
      await Promise.all([
        this.prisma.alerta.count({ where: { tipo: 'PISO_MARGEM', status: 'ABERTO' } }),
        this.prisma.alerta.count({ where: { status: 'ABERTO' } }),
        this.prisma.divergencia.count({ where: { status: 'ABERTA' } }),
        this.prisma.prestador.count({ where: { status: 'PENDENTE' } }),
      ]);
    const r = recompra[0];
    const base = n(r?.base);
    const pct = (x: bigint | undefined) => (base ? Math.round((n(x) * 10_000) / base) : null);
    const vendasN = vendasPeriodo._count._all;

    return {
      periodoDias: dias,
      geradoEm: agora,
      adesoesPeriodo,
      participantesAtivos,
      participantesComCompra90d: ativos90,
      recompra: {
        baseCompradores: base,
        em30diasBps: pct(r?.r30),
        em60diasBps: pct(r?.r60),
        em90diasBps: pct(r?.r90),
      },
      vendasParticipantes: vendasN,
      ticketMedioCentavos: vendasN
        ? Math.floor(n(vendasPeriodo._sum.baseCalculoCentavos) / vendasN)
        : 0,
      vendasIndicadas: {
        quantidade: indicadas._count._all,
        valorCentavos: n(indicadas._sum.baseCalculoCentavos),
        recompensaCentavos: n(indicadas._sum.recompensaCentavos),
      },
      cashback: {
        emitidoCentavos: soma(
          (o, t) => t === 'CREDITO' && ['COMPRA', 'BOAS_VINDAS', 'CAMPANHA'].includes(o),
        ),
        recompensaEmitidaCentavos: soma((o, t) => t === 'CREDITO' && o === 'INDICACAO'),
        resgatadoCentavos: -soma((o, t) => t === 'DEBITO' && o === 'RESGATE'),
        vencidoCentavos: -soma((_o, t) => t === 'VENCIMENTO'),
        estornadoCentavos: -soma((_o, t) => t === 'ESTORNO'),
        ajustesCentavos: soma((o) => o === 'AJUSTE_MANUAL'),
      },
      passivo: {
        pendenteCentavos: n(passivo.find((p) => p.estado === 'PENDENTE')?.total),
        disponivelCentavos: n(passivo.find((p) => p.estado === 'DISPONIVEL')?.total),
        saldoDevedorCentavos: Math.max(0, -(devedor._sum.valorCentavos ?? 0)),
      },
      alertas: {
        margemAbertos: alertasMargem,
        abertos: alertasAbertos,
        divergenciasAbertas,
        prestadoresPendentes,
      },
    };
  }

  /** Créditos por estado e vencimentos próximos (aba Bônus e resgates). */
  async bonusResgates() {
    const agora = this.relogio.agora();
    const em7 = new Date(agora.getTime() + 7 * 86_400_000);
    const porEstado = await this.prisma.$queryRaw<
      { estado: string; tipo: string; quantidade: bigint; total: bigint }[]
    >(Prisma.sql`
      SELECT l.estado::text, c.tipo::text, COUNT(*) AS quantidade, COALESCE(SUM(l."valorCentavos"), 0) AS total
        FROM lancamento l JOIN carteira c ON c.id = l."carteiraId"
       WHERE l."loteId" = l.id GROUP BY l.estado, c.tipo ORDER BY 1, 2`);
    const vencendo = await this.prisma.$queryRaw<
      { id: string; carteiraId: string; venceEm: Date; restante: bigint }[]
    >(Prisma.sql`
      SELECT l.id, l."carteiraId", l."venceEm", (SELECT SUM(x."valorCentavos") FROM lancamento x WHERE x."loteId" = l.id) AS restante
        FROM lancamento l WHERE l."loteId" = l.id AND l.estado = 'DISPONIVEL' AND l."venceEm" BETWEEN ${agora} AND ${em7}
       ORDER BY l."venceEm" LIMIT 200`);
    const reservas = await this.prisma.reserva.findMany({
      where: { status: 'ATIVA' },
      orderBy: { criadoEm: 'desc' },
      take: 100,
    });
    return {
      porEstado: porEstado.map((p) => ({ ...p, quantidade: n(p.quantidade), total: n(p.total) })),
      vencendo7dias: vencendo.map((v) => ({ ...v, restante: n(v.restante) })),
      reservasAbertas: reservas,
    };
  }
}
