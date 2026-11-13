import { Injectable, Logger } from '@nestjs/common';
import { CanalNotificacao, Prisma } from '@prisma/client';
import { dentroDoHorarioComercial, proximoHorarioComercial } from '@cdc/shared';
import { config } from '../comum/config';
import { PrismaService, type Tx } from '../comum/prisma.service';
import { Relogio } from '../comum/relogio';
import { RegrasService } from '../regras/regras.service';
import { criarProvedor, type ProvedorMensagem } from './provedores';

export type CodigoTemplate =
  | 'CREDITO_LIBERADO'
  | 'VENCE_EM_DIAS'
  | 'ULTIMO_DIA'
  | 'REATIVACAO'
  | 'PRESTADOR_VENDA_CONFIRMADA'
  | 'PRESTADOR_RECOMPENSA_LIBERADA'
  | 'PRESTADOR_APROVADO';


export function renderizar(corpo: string, dados: Record<string, unknown>): string {
  return corpo.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, chave: string) => String(dados[chave] ?? ''));
}

@Injectable()
export class NotificacoesService {
  private readonly logger = new Logger('Notificacoes');
  private readonly provedor: ProvedorMensagem = criarProvedor(config.notificador);

  constructor(
    private readonly prisma: PrismaService,
    private readonly relogio: Relogio,
    private readonly regras: RegrasService,
  ) {}

  /** Mensagens transacionais (OTP): envio imediato, sem exigir consentimento de comunicação. */
  async enviarTransacionalImediata(destino: string, texto: string) {
    const r = await this.provedor.enviar(destino, texto);
    if (!r.ok) this.logger.warn(`falha no envio transacional para ${destino}: ${r.erro}`);
    return r;
  }

  /** Consentimentos vigentes (o registro mais recente por tipo). */
  async consentimentosVigentes(pessoaId: string, tx?: Tx): Promise<Record<string, boolean>> {
    const cliente = tx ?? this.prisma;
    const todos = await cliente.consentimento.findMany({
      where: { pessoaId },
      orderBy: { criadoEm: 'asc' },
    });
    const vigentes: Record<string, boolean> = {};
    for (const c of todos) vigentes[c.tipo] = c.concedido;
    return vigentes;
  }

  private async canalPermitido(pessoaId: string, tx?: Tx): Promise<CanalNotificacao | null> {
    const c = await this.consentimentosVigentes(pessoaId, tx);
    if (c.MARKETING_WHATSAPP) return 'WHATSAPP';
    if (c.MARKETING_SMS) return 'SMS';
    return null;
  }

  /**
   * Agenda uma notificação para a pessoa, respeitando consentimento por canal e horário comercial.
   * `chave` garante que o mesmo aviso não seja criado duas vezes.
   */
  async agendar(
    entrada: {
      pessoaId: string;
      template: CodigoTemplate;
      dados: Record<string, unknown>;
      chave: string;
    },
    tx?: Tx,
  ) {
    const cliente = tx ?? this.prisma;
    const pessoa = await cliente.pessoa.findUnique({ where: { id: entrada.pessoaId } });
    if (!pessoa || pessoa.anonimizadaEm) return null;
    const agora = this.relogio.agora();
    const janela = (await this.regras.configuracaoEm(agora)).programa.parametros.comunicacao
      .horarioComercial;
    const canal = await this.canalPermitido(pessoa.id, tx);
    try {
      return await cliente.notificacao.create({
        data: {
          pessoaId: pessoa.id,
          destino: pessoa.telefone ?? '',
          canal: canal ?? 'WHATSAPP',
          template: entrada.template,
          dados: entrada.dados as Prisma.InputJsonValue,
          status: canal && pessoa.telefone ? 'PENDENTE' : 'BLOQUEADA_CONSENTIMENTO',
          agendadaPara: proximoHorarioComercial(agora, janela),
          chave: entrada.chave,
          marketing: true,
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return null; // já agendada
      throw e;
    }
  }

  /** Job: envia as notificações pendentes dentro do horário comercial (fuso Manaus). */
  async processarFila(limite = 200) {
    const agora = this.relogio.agora();
    const janela = (await this.regras.configuracaoEm(agora)).programa.parametros.comunicacao
      .horarioComercial;
    if (!dentroDoHorarioComercial(agora, janela)) return { enviadas: 0, falhas: 0, adiadas: true };
    const pendentes = await this.prisma.notificacao.findMany({
      where: { status: 'PENDENTE', agendadaPara: { lte: agora } },
      orderBy: { agendadaPara: 'asc' },
      take: limite,
    });
    const templates = new Map(
      (await this.prisma.templateNotificacao.findMany()).map((t) => [t.codigo, t]),
    );
    let enviadas = 0;
    let falhas = 0;
    for (const n of pendentes) {
      const template = templates.get(n.template);
      if (!template?.ativo) {
        await this.prisma.notificacao.update({
          where: { id: n.id },
          data: { status: 'CANCELADA', erro: 'template inativo ou inexistente' },
        });
        continue;
      }
      // consentimento é conferido de novo no envio (pode ter sido revogado)
      const canal = n.pessoaId ? await this.canalPermitido(n.pessoaId) : null;
      if (!canal) {
        await this.prisma.notificacao.update({
          where: { id: n.id },
          data: { status: 'BLOQUEADA_CONSENTIMENTO' },
        });
        continue;
      }
      const r = await this.provedor.enviar(
        n.destino,
        renderizar(template.corpo, n.dados as Record<string, unknown>),
      );
      await this.prisma.notificacao.update({
        where: { id: n.id },
        data: r.ok
          ? { status: 'ENVIADA', enviadaEm: agora, canal, tentativas: { increment: 1 } }
          : {
              status: n.tentativas + 1 >= 3 ? 'FALHOU' : 'PENDENTE',
              erro: r.erro,
              tentativas: { increment: 1 },
              agendadaPara: new Date(agora.getTime() + 15 * 60_000),
            },
      });
      if (r.ok) enviadas++;
      else falhas++;
    }
    return { enviadas, falhas, adiadas: false };
  }
}
