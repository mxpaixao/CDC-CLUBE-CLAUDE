import { Injectable } from '@nestjs/common';
import { SISTEMA } from '../comum/auditoria.service';
import { EstadoSistemaService } from '../comum/estado-sistema.service';
import { PrismaService } from '../comum/prisma.service';
import { Relogio } from '../comum/relogio';
import { RegrasService } from '../regras/regras.service';
import { AlertasService } from '../vendas/alertas.service';
import { ProcessamentoVendasService } from '../vendas/processamento.service';

/**
 * Conciliação diária: vendas importadas × reservas/resgates × devoluções.
 * Divergências vão para a fila do painel (aberta → resolvida | ignorada).
 */
@Injectable()
export class ConciliacaoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly relogio: Relogio,
    private readonly regras: RegrasService,
    private readonly alertas: AlertasService,
    private readonly estado: EstadoSistemaService,
    private readonly processamento: ProcessamentoVendasService,
  ) {}

  async executar() {
    const agora = this.relogio.agora();
    const params = (await this.regras.configuracaoAtual()).programa.parametros.conciliacao;
    const resultado = {
      reservasSemVenda: 0,
      vendasReconciliadas: 0,
      devolucoesPendentes: 0,
      contingencia: false,
    };

    // 1) reserva confirmada no caixa que não apareceu em nenhuma venda importada
    const limite = new Date(agora.getTime() - params.diasToleranciaReservaSemVenda * 86_400_000);
    const semVenda = await this.prisma.reserva.findMany({
      where: { status: 'CONFIRMADA', vendaId: null, confirmadaEm: { lt: limite } },
    });
    for (const r of semVenda) {
      // a venda pode ter chegado com o código depois da confirmação: tenta casar
      const venda = await this.prisma.venda.findFirst({ where: { codigoResgate: r.codigo } });
      if (venda) {
        await this.processamento.conciliarResgateDaVenda(venda.id, SISTEMA);
        resultado.vendasReconciliadas++;
        continue;
      }
      await this.alertas.divergencia({
        tipo: 'RESERVA_SEM_VENDA',
        severidade: 'MEDIA',
        descricao: `reserva ${r.codigo} (R$ ${(r.valorCentavos / 100).toFixed(2)}) confirmada no caixa sem venda importada após ${params.diasToleranciaReservaSemVenda} dia(s)`,
        referencia: r.id,
        chave: `reservasemvenda:${r.id}`,
        dados: { lojaId: r.lojaId, vendaErpRef: r.vendaErpRef },
      });
      resultado.reservasSemVenda++;
    }

    // 2) vendas com código ainda não conciliadas (ex.: reserva confirmada depois da importação)
    const pendentes = await this.prisma.venda.findMany({
      where: {
        codigoResgate: { not: null },
        criadoEm: { gte: new Date(agora.getTime() - 30 * 86_400_000) },
      },
      select: { id: true, codigoResgate: true },
    });
    for (const v of pendentes) {
      const r = await this.prisma.reserva.findUnique({ where: { codigo: v.codigoResgate! } });
      if (r && !r.vendaId) {
        await this.processamento.conciliarResgateDaVenda(v.id, SISTEMA);
        resultado.vendasReconciliadas++;
      }
    }

    // 3) devoluções que chegaram antes da venda: reprocessa
    const devPendentes = await this.prisma.divergencia.findMany({
      where: { tipo: 'DEVOLUCAO_SEM_VENDA', status: 'ABERTA' },
    });
    for (const d of devPendentes) {
      const dados = d.dados as {
        lojaCodigoErp: string;
        documentoVenda: string;
        documentoDevolucao: string;
        tipo: 'DEVOLUCAO' | 'CANCELAMENTO';
        data: string;
        itens: { numeroItem: string; quantidade: string; valorCentavos?: number | null }[];
      } | null;
      if (!dados) continue;
      const r = await this.processamento.processarDevolucao(
        { ...dados, data: new Date(dados.data) },
        null,
        SISTEMA,
      );
      if (!('pendente' in r && r.pendente)) {
        await this.prisma.divergencia.update({
          where: { id: d.id },
          data: {
            status: 'RESOLVIDA',
            resolucao: 'venda importada; devolução processada automaticamente',
            resolvidaEm: agora,
          },
        });
      } else resultado.devolucoesPendentes++;
    }

    // 4) integração parada: sem importação bem-sucedida há N horas → contingência
    const ultima = await this.estado.obter<{ em: string }>('ultima_importacao_ok');
    const horas = ultima ? (agora.getTime() - new Date(ultima.em).getTime()) / 3_600_000 : Infinity;
    if (ultima && horas > params.horasSemImportacaoParaContingencia) {
      await this.estado.definirContingencia(
        true,
        `sem importação bem-sucedida há ${Math.floor(horas)} horas`,
        SISTEMA,
      );
      resultado.contingencia = true;
    }
    await this.estado.definir('ultima_conciliacao', { em: agora.toISOString(), resultado });
    return resultado;
  }
}
