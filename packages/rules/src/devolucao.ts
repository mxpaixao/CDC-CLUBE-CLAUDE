import { AcumuladorBps, type Centavos, proporcaoFloor } from '@cdc/shared';
import type { ResultadoCalculo } from './calculo';

export interface ParametrosRecalculo {
  /** Valor líquido devolvido ACUMULADO por item (todas as devoluções até agora). */
  devolvidoPorItem: Record<string, Centavos>;
  aplicarCompraMinima: boolean;
  /** Recompensa efetivamente concedida na venda original (após teto mensal). */
  recompensaConcedidaCentavos: Centavos;
  /** Cashback efetivamente concedido na venda original. */
  cashbackConcedidoCentavos: Centavos;
}

export interface ResultadoRecalculo {
  /** Cashback que a venda deve gerar considerando o que restou. */
  cashbackDevidoCentavos: Centavos;
  /** Recompensa que a venda deve gerar considerando o que restou. */
  recompensaDevidaCentavos: Centavos;
  /** Parcela paga com cashback nos itens devolvidos (candidata a voltar para a carteira). */
  cashbackUtilizadoDevolvidoCentavos: Centavos;
  baseRemanescenteCentavos: Centavos;
  itens: { id: string; devolvidoCentavos: Centavos; baseRemanescenteCentavos: Centavos }[];
}

/**
 * Recalcula proporcionalmente aos itens devolvidos, mantendo os MESMOS percentuais
 * (e a mesma versão de regra) usados no cálculo original. Idempotente: recebe o devolvido
 * acumulado e devolve o valor devido; o estorno é (concedido − devido).
 */
export function recalcularAposDevolucao(
  original: ResultadoCalculo,
  p: ParametrosRecalculo,
): ResultadoRecalculo {
  const acCb = new AcumuladorBps();
  const acInd = new AcumuladorBps();
  let utilizadoDevolvido = 0;
  let baseRemanescente = 0;
  const itens = original.itens.map((item) => {
    const devolvido = Math.min(
      Math.max(p.devolvidoPorItem[item.id] ?? 0, 0),
      item.valorLiquidoCentavos,
    );
    if (item.tipo !== 'MERCADORIA' || item.valorLiquidoCentavos === 0) {
      return { id: item.id, devolvidoCentavos: devolvido, baseRemanescenteCentavos: 0 };
    }
    const restante = item.valorLiquidoCentavos - devolvido;
    const baseRest = proporcaoFloor(item.baseCentavos, restante, item.valorLiquidoCentavos);
    utilizadoDevolvido += proporcaoFloor(
      item.cashbackUtilizadoCentavos,
      devolvido,
      item.valorLiquidoCentavos,
    );
    baseRemanescente += baseRest;
    acCb.adicionar(baseRest, item.cashbackBps);
    acInd.adicionar(baseRest, item.indicacaoBps);
    return { id: item.id, devolvidoCentavos: devolvido, baseRemanescenteCentavos: baseRest };
  });

  let cashback = Math.min(acCb.resultadoFloor(), p.cashbackConcedidoCentavos);
  let recompensa = Math.min(acInd.resultadoFloor(), p.recompensaConcedidaCentavos);
  if (p.aplicarCompraMinima) {
    if (baseRemanescente < original.cashback.compraMinimaCentavos) cashback = 0;
    if (baseRemanescente < original.indicacao.compraMinimaCentavos) recompensa = 0;
  }
  return {
    cashbackDevidoCentavos: cashback,
    recompensaDevidaCentavos: recompensa,
    cashbackUtilizadoDevolvidoCentavos: utilizadoDevolvido,
    baseRemanescenteCentavos: baseRemanescente,
    itens,
  };
}
