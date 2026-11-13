import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dataLocal, diasCivisEntre, formatarDataLocal, mesCivilLocal } from '@cdc/shared';
import { LivroRazaoService } from '../carteiras/livro-razao.service';
import { ErroNegocio } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { Relogio } from '../comum/relogio';
import { ConciliacaoService } from '../conciliacao/conciliacao.service';
import { ImportacoesService } from '../importacoes/importacoes.service';
import { NotificacoesService } from '../notificacoes/notificacoes.service';
import { PrestadoresService } from '../prestadores/prestadores.service';
import { RegrasService } from '../regras/regras.service';

export const JOBS = [
  'liberar-creditos',
  'vencer-creditos',
  'expirar-reservas',
  'lembretes',
  'enviar-notificacoes',
  'conciliacao',
  'importar-pasta',
  'antifraude',
  'niveis-prestador',
] as const;
export type NomeJob = (typeof JOBS)[number];

/** Agenda (cron no fuso America/Manaus) usada pelo worker BullMQ. */
export const AGENDA: Record<NomeJob, string> = {
  'liberar-creditos': '5 * * * *', // de hora em hora (idempotente); a regra é por data local
  'vencer-creditos': '10 0 * * *',
  'expirar-reservas': '* * * * *',
  lembretes: '0 8 * * *',
  'enviar-notificacoes': '*/5 * * * *',
  conciliacao: '0 6 * * *',
  'importar-pasta': '*/5 * * * *',
  antifraude: '30 6 * * *',
  'niveis-prestador': '0 3 1 * *',
};

@Injectable()
export class JobsService {
  private readonly logger = new Logger('Jobs');

  constructor(
    private readonly prisma: PrismaService,
    private readonly relogio: Relogio,
    private readonly livro: LivroRazaoService,
    private readonly notificacoes: NotificacoesService,
    private readonly conciliacao: ConciliacaoService,
    private readonly importacoes: ImportacoesService,
    private readonly prestadores: PrestadoresService,
    private readonly regras: RegrasService,
  ) {}

  async executar(nome: string): Promise<unknown> {
    const inicio = Date.now();
    let r: unknown;
    switch (nome as NomeJob) {
      case 'liberar-creditos':
        r = await this.livro.liberarPendentes();
        break;
      case 'vencer-creditos':
        r = await this.livro.vencerCreditos();
        break;
      case 'expirar-reservas':
        r = await this.livro.expirarReservas();
        break;
      case 'lembretes':
        r = await this.lembretes();
        break;
      case 'enviar-notificacoes':
        r = await this.notificacoes.processarFila();
        break;
      case 'conciliacao':
        r = await this.conciliacao.executar();
        break;
      case 'importar-pasta':
        r = await this.importacoes.processarPastaMonitorada();
        break;
      case 'antifraude':
        r = await this.prestadores.varrerAntifraude();
        break;
      case 'niveis-prestador':
        r = await this.prestadores.recalcularNiveis();
        break;
      default:
        throw new ErroNegocio('JOB_DESCONHECIDO', `job desconhecido: ${nome}`, 404);
    }
    this.logger.log({ job: nome, duracaoMs: Date.now() - inicio, resultado: r });
    return r;
  }

  /** Avisos de vencimento (faltam N dias / último dia) e reativação (sem compra há N dias). */
  async lembretes() {
    const agora = this.relogio.agora();
    const com = (await this.regras.configuracaoAtual()).programa.parametros.comunicacao;
    const limite = new Date(agora.getTime() + (com.diasAvisoVencimento + 1) * 86_400_000);
    const lotes = await this.prisma.$queryRaw<
      {
        id: string;
        carteiraId: string;
        venceEm: Date;
        restante: bigint;
        pessoaId: string | null;
        empresaId: string | null;
      }[]
    >(Prisma.sql`
      SELECT l.id, l."carteiraId", l."venceEm", c."pessoaId", c."empresaId",
             (SELECT SUM(x."valorCentavos") FROM lancamento x WHERE x."loteId" = l.id) AS restante
        FROM lancamento l JOIN carteira c ON c.id = l."carteiraId"
       WHERE l."loteId" = l.id AND l.estado = 'DISPONIVEL' AND l."venceEm" > ${agora} AND l."venceEm" <= ${limite}`);
    let avisos = 0;
    const hoje = dataLocal(agora);
    for (const l of lotes) {
      const restante = Number(l.restante ?? 0);
      if (restante <= 0) continue;
      const pessoaId =
        l.pessoaId ??
        (
          await this.prisma.empresaComprador.findFirst({
            where: { empresaId: l.empresaId!, papel: 'RESPONSAVEL', ativo: true },
          })
        )?.pessoaId;
      if (!pessoaId) continue;
      const dias = diasCivisEntre(agora, l.venceEm);
      const valor = (restante / 100).toFixed(2).replace('.', ',');
      if (dataLocal(l.venceEm) === hoje) {
        if (
          await this.notificacoes.agendar({
            pessoaId,
            template: 'ULTIMO_DIA',
            dados: { valor },
            chave: `ultimo-dia:${l.id}`,
          })
        )
          avisos++;
      } else if (dias === com.diasAvisoVencimento) {
        if (
          await this.notificacoes.agendar({
            pessoaId,
            template: 'VENCE_EM_DIAS',
            dados: { valor, dias, data: formatarDataLocal(l.venceEm) },
            chave: `vence-em:${l.id}`,
          })
        )
          avisos++;
      }
    }
    const semCompra = new Date(agora.getTime() - com.diasReativacao * 86_400_000);
    const inativos = await this.prisma.participante.findMany({
      where: { status: 'ATIVO', tipo: 'CPF', ultimaCompraEm: { lt: semCompra } },
      select: { id: true, pessoaId: true },
      take: 5000,
    });
    let reativacao = 0;
    for (const p of inativos) {
      if (
        await this.notificacoes.agendar({
          pessoaId: p.pessoaId!,
          template: 'REATIVACAO',
          dados: {},
          chave: `reativacao:${p.id}:${mesCivilLocal(agora)}`,
        })
      )
        reativacao++;
    }
    return { avisosVencimento: avisos, reativacao };
  }
}
