import { Injectable, Logger } from '@nestjs/common';
import {
  type Carteira,
  type EstadoLancamento,
  type OrigemLancamento,
  Prisma,
  type TipoCarteira,
  type TipoLancamento,
} from '@prisma/client';
import {
  type EstadoLote,
  type Saldos,
  SaldoInsuficienteError,
  alocarFifo,
  avaliarResgate,
  calcularSaldos,
  distribuirEstorno,
  validarAjusteManual,
} from '@cdc/rules';
import { calcularVenceEm, gerarCodigoResgate, somarMinutos } from '@cdc/shared';
import { randomUUID } from 'node:crypto';
import { AuditoriaService, SISTEMA, type Ator } from '../comum/auditoria.service';
import { ErroNegocio } from '../comum/erros';
import { EstadoSistemaService } from '../comum/estado-sistema.service';
import { PrismaService, type Tx } from '../comum/prisma.service';
import { Relogio } from '../comum/relogio';
import { NotificacoesService } from '../notificacoes/notificacoes.service';
import { RegrasService } from '../regras/regras.service';

export interface TitularCarteira {
  pessoaId?: string | null;
  empresaId?: string | null;
}

export function chaveTitular(t: TitularCarteira): string {
  if (t.pessoaId) return `P:${t.pessoaId}`;
  if (t.empresaId) return `E:${t.empresaId}`;
  throw new Error('titular da carteira não informado');
}

export interface NovoLote {
  carteiraId: string;
  tipo: Extract<TipoLancamento, 'CREDITO' | 'AJUSTE'>;
  origem: OrigemLancamento;
  valorCentavos: number;
  estado: Extract<EstadoLancamento, 'PENDENTE' | 'DISPONIVEL'>;
  liberaEm?: Date | null;
  liberadoEm?: Date | null;
  venceEm?: Date | null;
  vendaId?: string | null;
  devolucaoId?: string | null;
  regraVersaoId?: string | null;
  chave: string;
  criadoPor: string;
  motivo?: string | null;
  detalhes?: Record<string, unknown> | null;
}

interface LoteRaw {
  id: string;
  estado: EstadoLote;
  seq: number;
  venceEm: Date | null;
  liberaEm: Date | null;
  restante: number;
}

const MENSAGENS_RESGATE: Record<string, string> = {
  SALDO_DEVEDOR:
    'há saldo devedor (devolução de compra com crédito já usado); resgates bloqueados até quitar',
  SALDO_ABAIXO_MINIMO: 'saldo disponível abaixo do mínimo para resgate',
  COMPRA_SEM_VALOR: 'informe o valor da compra',
  VALOR_ACIMA_DO_LIMITE: 'valor acima do limite de uso por compra',
  VALOR_ACIMA_DO_SALDO: 'valor acima do saldo disponível',
  VALOR_INVALIDO: 'valor inválido',
};

/**
 * Livro-razão do Clube. TODA operação que mexe em saldo:
 *   1) roda numa transação; 2) trava a carteira (SELECT … FOR UPDATE);
 *   3) recalcula o saldo a partir dos lançamentos (nunca de um campo de saldo);
 *   4) grava lançamentos com chave de idempotência única.
 */
@Injectable()
export class LivroRazaoService {
  private readonly logger = new Logger('LivroRazao');

  constructor(
    private readonly prisma: PrismaService,
    private readonly relogio: Relogio,
    private readonly regras: RegrasService,
    private readonly auditoria: AuditoriaService,
    private readonly estado: EstadoSistemaService,
    private readonly notificacoes: NotificacoesService,
  ) {}

  // ─────────────────────────────────────────── carteira

  async obterOuCriarCarteira(
    tx: Tx,
    tipo: TipoCarteira,
    titular: TitularCarteira,
  ): Promise<Carteira> {
    const chave = chaveTitular(titular);
    const existente = await tx.carteira.findUnique({
      where: { titularChave_tipo: { titularChave: chave, tipo } },
    });
    if (existente) return existente;
    // ON CONFLICT evita corrida entre duas importações simultâneas
    await tx.$executeRaw`
      INSERT INTO carteira (id, tipo, "titularChave", "pessoaId", "empresaId", "criadoEm")
      VALUES (${randomUUID()}, ${tipo}::"TipoCarteira", ${chave}, ${titular.pessoaId ?? null}, ${titular.empresaId ?? null}, now())
      ON CONFLICT ("titularChave", tipo) DO NOTHING`;
    return tx.carteira.findUniqueOrThrow({
      where: { titularChave_tipo: { titularChave: chave, tipo } },
    });
  }

  async travar(tx: Tx, carteiraId: string) {
    const r = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM carteira WHERE id = ${carteiraId} FOR UPDATE`;
    if (r.length === 0)
      throw new ErroNegocio('CARTEIRA_NAO_ENCONTRADA', 'carteira não encontrada', 404);
  }

  private async lotesAbertos(tx: Tx, carteiraId: string): Promise<LoteRaw[]> {
    return tx.$queryRaw<LoteRaw[]>`
      SELECT l.id, l.estado::text AS estado, l.seq, l."venceEm", l."liberaEm",
             COALESCE((SELECT SUM(x."valorCentavos") FROM lancamento x WHERE x."loteId" = l.id), 0)::int AS restante
        FROM lancamento l
       WHERE l."carteiraId" = ${carteiraId} AND l."loteId" = l.id AND l.estado IN ('PENDENTE', 'DISPONIVEL')`;
  }

  async restanteDoLote(tx: Tx, loteId: string): Promise<number> {
    const r = await tx.lancamento.aggregate({ where: { loteId }, _sum: { valorCentavos: true } });
    return r._sum.valorCentavos ?? 0;
  }

  private async retidoNoLote(tx: Tx, loteId: string, agora: Date): Promise<number> {
    const r = await tx.reservaAlocacao.aggregate({
      where: { loteId, reserva: { status: 'ATIVA', expiraEm: { gt: agora } } },
      _sum: { valorCentavos: true },
    });
    return r._sum.valorCentavos ?? 0;
  }

  /** Saldos calculados a partir dos lançamentos (chamar com a carteira travada para decisões). */
  async saldos(tx: Tx, carteiraId: string, agora = this.relogio.agora()): Promise<Saldos> {
    const [lotes, semLote, reservas] = await Promise.all([
      this.lotesAbertos(tx, carteiraId),
      tx.lancamento.aggregate({
        where: { carteiraId, loteId: null },
        _sum: { valorCentavos: true },
      }),
      tx.reserva.findMany({ where: { carteiraId, status: 'ATIVA' }, include: { alocacoes: true } }),
    ]);
    return calcularSaldos({
      lotes: lotes.map((l) => ({ ...l, restanteCentavos: Number(l.restante) })),
      reservasAtivas: reservas.map((r) => ({
        id: r.id,
        expiraEm: r.expiraEm,
        alocacoes: r.alocacoes.map((a) => ({ loteId: a.loteId, valorCentavos: a.valorCentavos })),
      })),
      semLoteCentavos: semLote._sum.valorCentavos ?? 0,
      agora,
    });
  }

  async resumo(carteiraId: string) {
    const agora = this.relogio.agora();
    const s = await this.saldos(this.prisma as unknown as Tx, carteiraId, agora);
    return {
      carteiraId,
      disponivelCentavos: s.disponivelCentavos,
      pendenteCentavos: s.pendenteCentavos,
      reservadoCentavos: s.reservadoCentavos,
      devedorCentavos: s.devedorCentavos,
      proximoVencimento: s.proximoVencimento,
    };
  }

  // ─────────────────────────────────────────── créditos

  /** Cria um lote de crédito. Idempotente pela chave. */
  async criarLote(tx: Tx, l: NovoLote) {
    if (!Number.isSafeInteger(l.valorCentavos) || l.valorCentavos <= 0) {
      throw new ErroNegocio(
        'VALOR_INVALIDO',
        'lote de crédito deve ter valor positivo em centavos',
        400,
      );
    }
    const existente = await tx.lancamento.findUnique({ where: { chaveIdempotencia: l.chave } });
    if (existente) return { lancamento: existente, criado: false };
    const id = randomUUID();
    const lancamento = await tx.lancamento.create({
      data: {
        id,
        loteId: id,
        carteiraId: l.carteiraId,
        tipo: l.tipo,
        origem: l.origem,
        valorCentavos: l.valorCentavos,
        estado: l.estado,
        liberaEm: l.liberaEm ?? null,
        liberadoEm: l.liberadoEm ?? null,
        venceEm: l.venceEm ?? null,
        vendaId: l.vendaId ?? null,
        devolucaoId: l.devolucaoId ?? null,
        regraVersaoId: l.regraVersaoId ?? null,
        chaveIdempotencia: l.chave,
        criadoPor: l.criadoPor,
        motivo: l.motivo ?? null,
        detalhes: (l.detalhes ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    return { lancamento, criado: true };
  }

  private async lancar(
    tx: Tx,
    d: {
      carteiraId: string;
      tipo: TipoLancamento;
      origem: OrigemLancamento;
      valorCentavos: number;
      loteId: string | null;
      chave: string;
      criadoPor: string;
      vendaId?: string | null;
      devolucaoId?: string | null;
      reservaId?: string | null;
      motivo?: string | null;
      detalhes?: Record<string, unknown>;
    },
  ) {
    const existente = await tx.lancamento.findUnique({ where: { chaveIdempotencia: d.chave } });
    if (existente) return existente;
    return tx.lancamento.create({
      data: {
        carteiraId: d.carteiraId,
        tipo: d.tipo,
        origem: d.origem,
        valorCentavos: d.valorCentavos,
        estado: 'EFETIVADO',
        loteId: d.loteId,
        chaveIdempotencia: d.chave,
        criadoPor: d.criadoPor,
        vendaId: d.vendaId ?? null,
        devolucaoId: d.devolucaoId ?? null,
        reservaId: d.reservaId ?? null,
        motivo: d.motivo ?? null,
        detalhes: (d.detalhes ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  private async marcarSeZerado(
    tx: Tx,
    loteId: string,
    estadoFinal: 'RESGATADO' | 'ESTORNADO' | 'VENCIDO',
  ) {
    const restante = await this.restanteDoLote(tx, loteId);
    if (restante !== 0) return;
    await tx.lancamento.updateMany({
      where: { id: loteId, estado: { in: ['PENDENTE', 'DISPONIVEL'] } },
      data: { estado: estadoFinal },
    });
  }

  private async parametrosCarteira(tipo: TipoCarteira, tx?: Tx) {
    const config = await this.regras.configuracaoEm(this.relogio.agora(), tx);
    return { config, params: config.programa.parametros.carteiras[tipo] };
  }

  // ─────────────────────────────────────────── jobs: liberação e vencimento

  /** PENDENTE → DISPONIVEL quando a carência termina. Pausado em contingência. */
  async liberarPendentes(limite = 2000) {
    const contingencia = await this.estado.contingencia();
    if (contingencia.ativa) return { liberados: 0, valorCentavos: 0, pausado: true };
    const agora = this.relogio.agora();
    const candidatos = await this.prisma.lancamento.findMany({
      where: { estado: 'PENDENTE', liberaEm: { lte: agora } },
      select: { id: true, carteiraId: true },
      orderBy: { seq: 'asc' },
      take: limite,
    });
    const porCarteira = new Map<string, string[]>();
    for (const c of candidatos)
      porCarteira.set(c.carteiraId, [...(porCarteira.get(c.carteiraId) ?? []), c.id]);
    let liberados = 0;
    let valor = 0;
    for (const [carteiraId, ids] of porCarteira) {
      const r = await this.prisma.transacao(async (tx) => {
        await this.travar(tx, carteiraId);
        const carteira = await tx.carteira.findUniqueOrThrow({ where: { id: carteiraId } });
        const { params } = await this.parametrosCarteira(carteira.tipo, tx);
        let n = 0;
        let v = 0;
        for (const id of ids) {
          const lote = await tx.lancamento.findUniqueOrThrow({ where: { id } });
          if (lote.estado !== 'PENDENTE') continue;
          const restante = await this.restanteDoLote(tx, id);
          // validade gravada no lote no momento do crédito (regra vigente na venda)
          const validade = Number(
            (lote.detalhes as { validadeDias?: number } | null)?.validadeDias ??
              params.validadeDias,
          );
          if (restante <= 0) {
            await tx.lancamento.update({ where: { id }, data: { estado: 'ESTORNADO' } });
            continue;
          }
          await tx.lancamento.update({
            where: { id },
            data: {
              estado: 'DISPONIVEL',
              liberadoEm: agora,
              venceEm: calcularVenceEm(agora, validade),
            },
          });
          n++;
          v += restante;
        }
        await this.quitarSaldoDevedor(tx, carteiraId, agora);
        return { n, v, carteira };
      });
      liberados += r.n;
      valor += r.v;
      if (r.n > 0)
        await this.notificarTitular(
          r.carteira,
          r.carteira.tipo === 'PRESTADOR' ? 'PRESTADOR_RECOMPENSA_LIBERADA' : 'CREDITO_LIBERADO',
          { valor: r.v },
          `liberacao:${carteiraId}:${agora.toISOString().slice(0, 10)}`,
        );
    }
    return { liberados, valorCentavos: valor, pausado: false };
  }

  /** DISPONIVEL → VENCIDO. Parte reservada (reserva ativa) é preservada até a reserva terminar. */
  async vencerCreditos(limite = 2000) {
    const agora = this.relogio.agora();
    const candidatos = await this.prisma.lancamento.findMany({
      where: { estado: 'DISPONIVEL', venceEm: { lte: agora } },
      select: { id: true, carteiraId: true },
      take: limite,
    });
    let vencidos = 0;
    let valor = 0;
    for (const c of candidatos) {
      const v = await this.prisma.transacao(async (tx) => {
        await this.travar(tx, c.carteiraId);
        const lote = await tx.lancamento.findUniqueOrThrow({ where: { id: c.id } });
        if (lote.estado !== 'DISPONIVEL') return 0;
        const restante = await this.restanteDoLote(tx, c.id);
        const retido = await this.retidoNoLote(tx, c.id, agora);
        const livre = Math.max(restante - retido, 0);
        if (livre > 0) {
          await this.lancar(tx, {
            carteiraId: c.carteiraId,
            tipo: 'VENCIMENTO',
            origem: 'VENCIMENTO',
            valorCentavos: -livre,
            loteId: c.id,
            chave: `vencimento:${c.id}:${restante}:${retido}`,
            criadoPor: 'SISTEMA',
          });
        }
        if (retido === 0) {
          await tx.lancamento.update({
            where: { id: c.id },
            data: { estado: restante > 0 || livre > 0 ? 'VENCIDO' : 'RESGATADO' },
          });
        }
        return livre;
      });
      if (v > 0) {
        vencidos++;
        valor += v;
      }
    }
    return { vencidos, valorCentavos: valor };
  }

  // ─────────────────────────────────────────── resgate no caixa

  async reservar(
    e: {
      carteiraId: string;
      valorCompraCentavos: number;
      valorCentavos: number;
      lojaId: string;
      chave: string;
      autenticacaoTitular?: string | null;
      liberacaoSupervisor?: string | null;
    },
    ator: Ator,
  ) {
    return this.prisma.transacao(async (tx) => {
      const ja = await tx.reserva.findUnique({
        where: { chaveIdempotencia: e.chave },
        include: { alocacoes: true },
      });
      if (ja) return ja;
      await this.travar(tx, e.carteiraId);
      const agora = this.relogio.agora();
      const carteira = await tx.carteira.findUniqueOrThrow({ where: { id: e.carteiraId } });
      const { config, params } = await this.parametrosCarteira(carteira.tipo, tx);
      if (params.exigeAutenticacaoTitular && !e.autenticacaoTitular) {
        throw new ErroNegocio(
          'AUTENTICACAO_TITULAR',
          'resgate desta carteira exige código (OTP) do titular',
          403,
        );
      }
      const contingencia = await this.estado.contingencia(tx);
      if (contingencia.ativa && !e.liberacaoSupervisor) {
        throw new ErroNegocio(
          'CONTINGENCIA',
          'integração com o ERP em contingência: resgate exige liberação do supervisor',
          423,
        );
      }
      const saldos = await this.saldos(tx, e.carteiraId, agora);
      const av = avaliarResgate({
        saldoDisponivelCentavos: saldos.disponivelCentavos,
        saldoDevedorCentavos: saldos.devedorCentavos,
        valorCompraCentavos: e.valorCompraCentavos,
        valorSolicitadoCentavos: e.valorCentavos,
        parametros: params,
      });
      if (!av.permitido) {
        throw new ErroNegocio(
          av.motivo!,
          MENSAGENS_RESGATE[av.motivo!] ?? 'resgate não permitido',
          422,
          {
            saldoDisponivelCentavos: av.saldoDisponivelCentavos,
            limitePorCompraCentavos: av.limitePorCompraCentavos,
            maximoResgatavelCentavos: av.maximoResgatavelCentavos,
          },
        );
      }
      let alocacoes;
      try {
        alocacoes = alocarFifo(saldos.lotesLivres, e.valorCentavos);
      } catch (err) {
        if (err instanceof SaldoInsuficienteError)
          throw new ErroNegocio('VALOR_ACIMA_DO_SALDO', MENSAGENS_RESGATE.VALOR_ACIMA_DO_SALDO);
        throw err;
      }
      let codigo = gerarCodigoResgate();
      while (await tx.reserva.findUnique({ where: { codigo } })) codigo = gerarCodigoResgate();
      const reserva = await tx.reserva.create({
        data: {
          carteiraId: e.carteiraId,
          valorCentavos: e.valorCentavos,
          valorCompraCentavos: e.valorCompraCentavos,
          codigo,
          expiraEm: somarMinutos(agora, config.programa.parametros.reservaTtlMinutos),
          lojaId: e.lojaId,
          operadorId: ator.id ?? 'SISTEMA',
          chaveIdempotencia: e.chave,
          autenticacaoTitular: e.autenticacaoTitular ?? null,
          alocacoes: {
            create: alocacoes.map((a) => ({ loteId: a.loteId, valorCentavos: a.valorCentavos })),
          },
        },
        include: { alocacoes: true },
      });
      await this.auditoria.registrar(
        ator,
        'RESERVA_CRIADA',
        'Reserva',
        reserva.id,
        {
          depois: {
            codigo,
            valorCentavos: e.valorCentavos,
            valorCompraCentavos: e.valorCompraCentavos,
            carteiraId: e.carteiraId,
            alocacoes,
            liberacaoSupervisor: e.liberacaoSupervisor ?? null,
          },
          motivo: e.liberacaoSupervisor ?? null,
        },
        tx,
      );
      return reserva;
    });
  }

  async confirmarReserva(reservaId: string, vendaErpRef: string | null, ator: Ator) {
    return this.prisma.transacao(async (tx) => {
      const r0 = await tx.reserva.findUnique({ where: { id: reservaId } });
      if (!r0) throw new ErroNegocio('NAO_ENCONTRADO', 'reserva não encontrada', 404);
      await this.travar(tx, r0.carteiraId);
      const reserva = await tx.reserva.findUniqueOrThrow({
        where: { id: reservaId },
        include: { alocacoes: true },
      });
      if (reserva.status === 'CONFIRMADA') return reserva;
      const agora = this.relogio.agora();
      if (reserva.status !== 'ATIVA' || reserva.expiraEm.getTime() <= agora.getTime()) {
        throw new ErroNegocio(
          'RESERVA_INDISPONIVEL',
          `reserva ${reserva.status === 'ATIVA' ? 'EXPIRADA' : reserva.status} — gere uma nova`,
          409,
        );
      }
      for (const a of reserva.alocacoes) {
        const restante = await this.restanteDoLote(tx, a.loteId);
        if (restante < a.valorCentavos) {
          // nunca deveria acontecer: todas as operações respeitam as reservas ativas
          throw new ErroNegocio(
            'INCONSISTENCIA_RESERVA',
            `lote ${a.loteId} sem saldo para a reserva`,
            500,
          );
        }
        await this.lancar(tx, {
          carteiraId: reserva.carteiraId,
          tipo: 'DEBITO',
          origem: 'RESGATE',
          valorCentavos: -a.valorCentavos,
          loteId: a.loteId,
          reservaId: reserva.id,
          chave: `resgate:${reserva.id}:${a.id}`,
          criadoPor: ator.id ?? 'SISTEMA',
          detalhes: { codigo: reserva.codigo, vendaErpRef },
        });
        await this.marcarSeZerado(tx, a.loteId, 'RESGATADO');
      }
      const confirmada = await tx.reserva.update({
        where: { id: reserva.id },
        data: {
          status: 'CONFIRMADA',
          confirmadaEm: agora,
          vendaErpRef: vendaErpRef ?? reserva.vendaErpRef,
        },
        include: { alocacoes: true },
      });
      await this.auditoria.registrar(
        ator,
        'RESERVA_CONFIRMADA',
        'Reserva',
        reserva.id,
        { depois: { vendaErpRef, valorCentavos: reserva.valorCentavos } },
        tx,
      );
      return confirmada;
    });
  }

  async cancelarReserva(reservaId: string, motivo: string, ator: Ator) {
    return this.prisma.transacao(async (tx) => {
      const r0 = await tx.reserva.findUnique({ where: { id: reservaId } });
      if (!r0) throw new ErroNegocio('NAO_ENCONTRADO', 'reserva não encontrada', 404);
      await this.travar(tx, r0.carteiraId);
      const reserva = await tx.reserva.findUniqueOrThrow({ where: { id: reservaId } });
      if (reserva.status === 'CANCELADA' || reserva.status === 'EXPIRADA') return reserva;
      if (reserva.status !== 'ATIVA')
        throw new ErroNegocio(
          'RESERVA_INDISPONIVEL',
          `reserva ${reserva.status} não pode ser cancelada`,
          409,
        );
      const cancelada = await tx.reserva.update({
        where: { id: reservaId },
        data: {
          status: 'CANCELADA',
          canceladaEm: this.relogio.agora(),
          motivoCancelamento: motivo,
        },
      });
      await this.auditoria.registrar(
        ator,
        'RESERVA_CANCELADA',
        'Reserva',
        reservaId,
        { motivo },
        tx,
      );
      await this.quitarSaldoDevedor(tx, reserva.carteiraId, this.relogio.agora());
      return cancelada;
    });
  }

  /** Job: formaliza a expiração (o saldo já deixou de ser retido no instante expiraEm). */
  async expirarReservas() {
    const agora = this.relogio.agora();
    const expiradas = await this.prisma.reserva.findMany({
      where: { status: 'ATIVA', expiraEm: { lte: agora } },
      select: { id: true, carteiraId: true },
    });
    for (const r of expiradas) {
      await this.prisma.transacao(async (tx) => {
        await this.travar(tx, r.carteiraId);
        const n = await tx.reserva.updateMany({
          where: { id: r.id, status: 'ATIVA' },
          data: { status: 'EXPIRADA' },
        });
        if (n.count) {
          await this.auditoria.registrar(SISTEMA, 'RESERVA_EXPIRADA', 'Reserva', r.id, {}, tx);
          await this.quitarSaldoDevedor(tx, r.carteiraId, agora);
        }
      });
    }
    return { expiradas: expiradas.length };
  }

  // ─────────────────────────────────────────── estornos e saldo devedor

  /**
   * Ajusta o estorno ACUMULADO de um lote para `estornoTotalCentavos` (idempotente: chamar de novo
   * com o mesmo total não gera nada). Ordem: livre no lote → já vencido → saldo devedor (D-011).
   */
  async estornarLoteAte(
    tx: Tx,
    e: {
      loteId: string;
      estornoTotalCentavos: number;
      devolucaoId: string | null;
      vendaId: string | null;
      chave: string;
      criadoPor: string;
      motivo: string;
    },
  ) {
    const lote = await tx.lancamento.findUniqueOrThrow({ where: { id: e.loteId } });
    await this.travar(tx, lote.carteiraId);
    const agora = this.relogio.agora();
    const entradas = await tx.lancamento.findMany({ where: { loteId: e.loteId } });
    const restante = entradas.reduce((a, l) => a + l.valorCentavos, 0);
    const jaEstornadoDoLote = -entradas
      .filter((l) => l.tipo === 'ESTORNO')
      .reduce((a, l) => a + l.valorCentavos, 0);
    const vencido = -entradas
      .filter((l) => l.tipo === 'VENCIMENTO')
      .reduce((a, l) => a + l.valorCentavos, 0);
    const dividas = await tx.lancamento.aggregate({
      where: {
        loteId: null,
        tipo: 'ESTORNO',
        detalhes: { path: ['loteOrigem'], equals: e.loteId },
      },
      _sum: { valorCentavos: true },
    });
    const jaDevedor = -(dividas._sum.valorCentavos ?? 0);
    const retido = lote.estado === 'DISPONIVEL' ? await this.retidoNoLote(tx, e.loteId, agora) : 0;
    const livre =
      lote.estado === 'PENDENTE' || lote.estado === 'DISPONIVEL'
        ? Math.max(restante - retido, 0)
        : 0;

    const alvo = distribuirEstorno({
      valorEstornoCentavos: Math.min(e.estornoTotalCentavos, lote.valorCentavos),
      livreNoLoteCentavos: livre + jaEstornadoDoLote,
      vencidoDoLoteCentavos: vencido,
    });
    const doLote = Math.max(alvo.estornarDoLoteCentavos - jaEstornadoDoLote, 0);
    const devedor = Math.max(alvo.saldoDevedorCentavos - jaDevedor, 0);
    if (doLote > 0) {
      await this.lancar(tx, {
        carteiraId: lote.carteiraId,
        tipo: 'ESTORNO',
        origem: 'ESTORNO',
        valorCentavos: -doLote,
        loteId: e.loteId,
        chave: `${e.chave}:lote`,
        criadoPor: e.criadoPor,
        vendaId: e.vendaId,
        devolucaoId: e.devolucaoId,
        motivo: e.motivo,
      });
      await this.marcarSeZerado(tx, e.loteId, 'ESTORNADO');
    }
    if (devedor > 0) {
      await this.lancar(tx, {
        carteiraId: lote.carteiraId,
        tipo: 'ESTORNO',
        origem: 'ESTORNO',
        valorCentavos: -devedor,
        loteId: null,
        chave: `${e.chave}:devedor`,
        criadoPor: e.criadoPor,
        vendaId: e.vendaId,
        devolucaoId: e.devolucaoId,
        motivo: `${e.motivo} (crédito já utilizado → saldo devedor)`,
        detalhes: { loteOrigem: e.loteId },
      });
      await this.quitarSaldoDevedor(tx, lote.carteiraId, agora);
    }
    return {
      estornadoDoLoteCentavos: doLote,
      saldoDevedorCentavos: devedor,
      absorvidoPorVencimentoCentavos: alvo.absorvidoPorVencimentoCentavos,
    };
  }

  /** Abate o saldo devedor com o saldo livre (FIFO). Lançamentos em par: débito no lote + crédito sem lote. */
  async quitarSaldoDevedor(tx: Tx, carteiraId: string, agora: Date) {
    const s = await this.saldos(tx, carteiraId, agora);
    const valor = Math.min(s.devedorCentavos, s.disponivelCentavos);
    if (valor <= 0) return 0;
    const operacao = randomUUID();
    for (const a of alocarFifo(s.lotesLivres, valor)) {
      await this.lancar(tx, {
        carteiraId,
        tipo: 'DEBITO',
        origem: 'QUITACAO_SALDO_DEVEDOR',
        valorCentavos: -a.valorCentavos,
        loteId: a.loteId,
        chave: `quitacao:${operacao}:${a.loteId}:debito`,
        criadoPor: 'SISTEMA',
      });
      await this.lancar(tx, {
        carteiraId,
        tipo: 'AJUSTE',
        origem: 'QUITACAO_SALDO_DEVEDOR',
        valorCentavos: a.valorCentavos,
        loteId: null,
        chave: `quitacao:${operacao}:${a.loteId}:quita`,
        criadoPor: 'SISTEMA',
      });
      await this.marcarSeZerado(tx, a.loteId, 'RESGATADO');
    }
    return valor;
  }

  // ─────────────────────────────────────────── ajuste manual

  async ajusteManual(
    e: { carteiraId: string; valorCentavos: number; motivo: string; chave: string },
    ator: Ator,
  ) {
    const v = validarAjusteManual({ valorCentavos: e.valorCentavos, motivo: e.motivo });
    if (!v.valido) throw new ErroNegocio('AJUSTE_INVALIDO', v.erro, 400);
    return this.prisma.transacao(async (tx) => {
      const ja = await tx.lancamento.findFirst({
        where: {
          OR: [
            { chaveIdempotencia: `ajuste:${e.chave}` },
            { chaveIdempotencia: { startsWith: `ajuste:${e.chave}:` } },
          ],
        },
      });
      if (ja) return { lancamentos: [ja], repetido: true };
      await this.travar(tx, e.carteiraId);
      const agora = this.relogio.agora();
      const carteira = await tx.carteira.findUniqueOrThrow({ where: { id: e.carteiraId } });
      const { params } = await this.parametrosCarteira(carteira.tipo, tx);
      const antes = await this.saldos(tx, e.carteiraId, agora);
      const lancamentos = [];
      if (e.valorCentavos > 0) {
        const { lancamento } = await this.criarLote(tx, {
          carteiraId: e.carteiraId,
          tipo: 'AJUSTE',
          origem: 'AJUSTE_MANUAL',
          valorCentavos: e.valorCentavos,
          estado: 'DISPONIVEL',
          liberadoEm: agora,
          venceEm: calcularVenceEm(agora, params.validadeDias),
          chave: `ajuste:${e.chave}`,
          criadoPor: ator.id ?? 'SISTEMA',
          motivo: e.motivo,
          detalhes: { validadeDias: params.validadeDias },
        });
        lancamentos.push(lancamento);
        await this.quitarSaldoDevedor(tx, e.carteiraId, agora);
      } else {
        const valor = -e.valorCentavos;
        if (valor > antes.disponivelCentavos) {
          throw new ErroNegocio(
            'SALDO_INSUFICIENTE',
            'ajuste negativo maior que o saldo disponível',
            422,
            { disponivelCentavos: antes.disponivelCentavos },
          );
        }
        for (const a of alocarFifo(antes.lotesLivres, valor)) {
          lancamentos.push(
            await this.lancar(tx, {
              carteiraId: e.carteiraId,
              tipo: 'AJUSTE',
              origem: 'AJUSTE_MANUAL',
              valorCentavos: -a.valorCentavos,
              loteId: a.loteId,
              chave: `ajuste:${e.chave}:${a.loteId}`,
              criadoPor: ator.id ?? 'SISTEMA',
              motivo: e.motivo,
            }),
          );
          await this.marcarSeZerado(tx, a.loteId, 'RESGATADO');
        }
      }
      const depois = await this.saldos(tx, e.carteiraId, agora);
      await this.auditoria.registrar(
        ator,
        'AJUSTE_SALDO',
        'Carteira',
        e.carteiraId,
        {
          antes: {
            disponivelCentavos: antes.disponivelCentavos,
            devedorCentavos: antes.devedorCentavos,
          },
          depois: {
            disponivelCentavos: depois.disponivelCentavos,
            devedorCentavos: depois.devedorCentavos,
            valorCentavos: e.valorCentavos,
          },
          motivo: e.motivo,
        },
        tx,
      );
      return { lancamentos, repetido: false };
    });
  }

  // ─────────────────────────────────────────── consulta

  async extrato(carteiraId: string, pagina = 1, porPagina = 50) {
    const [itens, total] = await Promise.all([
      this.prisma.lancamento.findMany({
        where: { carteiraId },
        orderBy: { seq: 'desc' },
        skip: (pagina - 1) * porPagina,
        take: porPagina,
        include: { venda: { select: { documentoErp: true, lojaId: true, dataConfirmacao: true } } },
      }),
      this.prisma.lancamento.count({ where: { carteiraId } }),
    ]);
    return {
      total,
      pagina,
      itens: itens.map((l) => ({
        id: l.id,
        data: l.criadoEm,
        tipo: l.tipo,
        origem: l.origem,
        estado: l.estado,
        valorCentavos: l.valorCentavos,
        liberaEm: l.liberaEm,
        venceEm: l.venceEm,
        loteId: l.loteId,
        ehLote: l.loteId === l.id,
        motivo: l.motivo,
        venda: l.venda,
        regraVersaoId: l.regraVersaoId,
      })),
    };
  }

  async notificarTitular(
    carteira: Carteira,
    template: 'CREDITO_LIBERADO' | 'PRESTADOR_RECOMPENSA_LIBERADA',
    dados: Record<string, unknown>,
    chave: string,
  ) {
    try {
      let pessoaId = carteira.pessoaId;
      if (!pessoaId && carteira.empresaId) {
        const resp = await this.prisma.empresaComprador.findFirst({
          where: { empresaId: carteira.empresaId, papel: 'RESPONSAVEL', ativo: true },
        });
        pessoaId = resp?.pessoaId ?? null;
      }
      if (!pessoaId) return;
      const valor = Number(dados.valor ?? 0);
      await this.notificacoes.agendar({
        pessoaId,
        template,
        dados: { ...dados, valor: (valor / 100).toFixed(2).replace('.', ',') },
        chave,
      });
    } catch (e) {
      this.logger.warn(`falha ao agendar notificação: ${(e as Error).message}`);
    }
  }
}
