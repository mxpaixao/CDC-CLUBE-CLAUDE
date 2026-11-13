import type { Bps, Centavos } from '@cdc/shared';
import type { ResultadoCalculo } from './calculo';
import type { ConfiguracaoVigente } from './configuracao';

export interface AlertaMargem {
  familia: string;
  regraVersaoId: string;
  valorBrutoCentavos: Centavos;
  descontosCentavos: Centavos;
  cashbackEstimadoCentavos: Centavos;
  indicacaoEstimadaCentavos: Centavos;
  concessaoBps: Bps;
  concessaoMaximaBps: Bps | null;
  margemBps: Bps | null;
  margemMinimaBps: Bps | null;
  motivo: 'CONCESSAO_ACIMA_DO_PISO' | 'MARGEM_ABAIXO_DO_PISO';
}

/**
 * Fase 1: apenas ALERTA (não bloqueia) quando descontos + cashback + indicação ultrapassam o
 * piso configurado por família. Se o arquivo do ERP trouxer custo, avalia também a margem.
 */
export function avaliarPisosMargem(
  resultado: ResultadoCalculo,
  config: ConfiguracaoVigente,
  recompensaConcedidaCentavos: Centavos = resultado.indicacao.valorCentavos,
): AlertaMargem[] {
  if (config.pisos.length === 0) return [];
  const cashbackTotal = resultado.cashback.valorCentavos;
  const indicacaoTotal = recompensaConcedidaCentavos;
  const alertas: AlertaMargem[] = [];
  const familias = new Set(
    resultado.itens
      .filter((i) => i.tipo === 'MERCADORIA' && i.familia)
      .map((i) => i.familia as string),
  );
  for (const familia of familias) {
    const piso = config.pisos.find((p) => p.filtros.familia === familia);
    if (!piso) continue;
    const itens = resultado.itens.filter((i) => i.tipo === 'MERCADORIA' && i.familia === familia);
    const bruto = itens.reduce((a, i) => a + i.valorBrutoCentavos, 0);
    if (bruto === 0) continue;
    const descontos = itens.reduce((a, i) => a + i.descontoCentavos, 0);
    // estimativa proporcional: parte do crédito total atribuível aos itens da família
    const brutoCb = BigInt(resultado.cashback.brutoDecimilesimos);
    const brutoInd = BigInt(resultado.indicacao.brutoDecimilesimos);
    const famCb = itens.reduce((a, i) => a + BigInt(i.baseCentavos) * BigInt(i.cashbackBps), 0n);
    const famInd = itens.reduce((a, i) => a + BigInt(i.baseCentavos) * BigInt(i.indicacaoBps), 0n);
    const cb = brutoCb > 0n ? Number((BigInt(cashbackTotal) * famCb) / brutoCb) : 0;
    const ind = brutoInd > 0n ? Number((BigInt(indicacaoTotal) * famInd) / brutoInd) : 0;
    const concessao = descontos + cb + ind;
    const concessaoBps = Math.floor((concessao * 10_000) / bruto);
    const { concessaoMaximaBps, margemMinimaBps } = piso.parametros;
    const custos = itens.map((i) => i.custoCentavos);
    const temCusto = custos.every((c) => c !== null && c !== undefined);
    const custo = temCusto ? custos.reduce<number>((a, c) => a + (c as number), 0) : null;
    const margemBps =
      custo !== null ? Math.floor(((bruto - concessao - custo) * 10_000) / bruto) : null;
    const base = {
      familia,
      regraVersaoId: piso.regraVersaoId,
      valorBrutoCentavos: bruto,
      descontosCentavos: descontos,
      cashbackEstimadoCentavos: cb,
      indicacaoEstimadaCentavos: ind,
      concessaoBps,
      concessaoMaximaBps: concessaoMaximaBps ?? null,
      margemBps,
      margemMinimaBps: margemMinimaBps ?? null,
    };
    if (margemMinimaBps !== undefined && margemBps !== null && margemBps < margemMinimaBps) {
      alertas.push({ ...base, motivo: 'MARGEM_ABAIXO_DO_PISO' });
    } else if (concessaoMaximaBps !== undefined && concessaoBps > concessaoMaximaBps) {
      alertas.push({ ...base, motivo: 'CONCESSAO_ACIMA_DO_PISO' });
    }
  }
  return alertas;
}
