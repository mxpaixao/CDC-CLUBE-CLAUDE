import {
  type Centavos,
  type ParametrosCarteira,
  aplicarBpsFloor,
  exigirCentavos,
} from '@cdc/shared';

/** Lote de crédito disponível para consumo FIFO. */
export interface LoteDisponivel {
  id: string;
  venceEm: Date;
  /** ordem de criação (desempate) */
  seq: number;
  /** valor livre = restante − reservas ativas */
  livreCentavos: Centavos;
}

export interface Alocacao {
  loteId: string;
  valorCentavos: Centavos;
}

export class SaldoInsuficienteError extends Error {
  constructor(
    public readonly disponivel: Centavos,
    public readonly solicitado: Centavos,
  ) {
    super(`saldo insuficiente: disponível ${disponivel}, solicitado ${solicitado}`);
    this.name = 'SaldoInsuficienteError';
  }
}

/** Ordena lotes por vencimento (o que vence primeiro é usado primeiro). */
export function ordenarFifo<T extends Pick<LoteDisponivel, 'venceEm' | 'seq'>>(
  lotes: readonly T[],
): T[] {
  return [...lotes].sort((a, b) => a.venceEm.getTime() - b.venceEm.getTime() || a.seq - b.seq);
}

/** Consome `valor` dos lotes em ordem FIFO por vencimento. */
export function alocarFifo(lotes: readonly LoteDisponivel[], valor: Centavos): Alocacao[] {
  exigirCentavos(valor);
  if (valor <= 0) throw new Error('valor a alocar deve ser positivo');
  const disponivel = lotes.reduce((a, l) => a + Math.max(l.livreCentavos, 0), 0);
  if (disponivel < valor) throw new SaldoInsuficienteError(disponivel, valor);
  const alocacoes: Alocacao[] = [];
  let falta = valor;
  for (const lote of ordenarFifo(lotes)) {
    if (falta === 0) break;
    if (lote.livreCentavos <= 0) continue;
    const usar = Math.min(lote.livreCentavos, falta);
    alocacoes.push({ loteId: lote.id, valorCentavos: usar });
    falta -= usar;
  }
  return alocacoes;
}

export type MotivoBloqueioResgate =
  | 'SALDO_DEVEDOR'
  | 'SALDO_ABAIXO_MINIMO'
  | 'COMPRA_SEM_VALOR'
  | 'VALOR_ACIMA_DO_LIMITE'
  | 'VALOR_ACIMA_DO_SALDO'
  | 'VALOR_INVALIDO';

export interface AvaliacaoResgate {
  permitido: boolean;
  motivo: MotivoBloqueioResgate | null;
  saldoDisponivelCentavos: Centavos;
  limitePorCompraCentavos: Centavos;
  maximoResgatavelCentavos: Centavos;
}

/**
 * Regras de uso do saldo numa nova compra:
 * - saldo devedor > 0 bloqueia qualquer resgate;
 * - saldo disponível precisa atingir o mínimo para resgate;
 * - limite = floor(valor da compra × limiteUsoBps).
 */
export function avaliarResgate(entrada: {
  saldoDisponivelCentavos: Centavos;
  saldoDevedorCentavos: Centavos;
  valorCompraCentavos: Centavos;
  valorSolicitadoCentavos?: Centavos;
  parametros: ParametrosCarteira;
}): AvaliacaoResgate {
  const { saldoDisponivelCentavos: saldo, parametros } = entrada;
  const limite =
    entrada.valorCompraCentavos > 0
      ? aplicarBpsFloor(entrada.valorCompraCentavos, parametros.limiteUsoBps)
      : 0;
  const maximo = Math.max(0, Math.min(saldo, limite));
  const base = {
    saldoDisponivelCentavos: saldo,
    limitePorCompraCentavos: limite,
    maximoResgatavelCentavos: maximo,
  };
  const negar = (motivo: MotivoBloqueioResgate): AvaliacaoResgate => ({
    ...base,
    permitido: false,
    motivo,
    maximoResgatavelCentavos:
      motivo === 'SALDO_DEVEDOR' || motivo === 'SALDO_ABAIXO_MINIMO' ? 0 : maximo,
  });

  if (entrada.saldoDevedorCentavos > 0) return negar('SALDO_DEVEDOR');
  if (saldo < parametros.saldoMinimoResgateCentavos || saldo <= 0)
    return negar('SALDO_ABAIXO_MINIMO');
  if (entrada.valorCompraCentavos <= 0) return negar('COMPRA_SEM_VALOR');
  const solicitado = entrada.valorSolicitadoCentavos;
  if (solicitado !== undefined) {
    if (!Number.isSafeInteger(solicitado) || solicitado <= 0) return negar('VALOR_INVALIDO');
    if (solicitado > saldo) return negar('VALOR_ACIMA_DO_SALDO');
    if (solicitado > limite) return negar('VALOR_ACIMA_DO_LIMITE');
  }
  return { ...base, permitido: true, motivo: null };
}

/**
 * Como um estorno (devolução) afeta um lote de crédito:
 * 1º sai do valor ainda livre no lote; 2º do que já venceu (não custou nada à CDC);
 * 3º o que já foi usado vira SALDO DEVEDOR da carteira (D-011).
 */
export function distribuirEstorno(entrada: {
  valorEstornoCentavos: Centavos;
  livreNoLoteCentavos: Centavos;
  vencidoDoLoteCentavos: Centavos;
}): {
  estornarDoLoteCentavos: Centavos;
  absorvidoPorVencimentoCentavos: Centavos;
  saldoDevedorCentavos: Centavos;
} {
  const v = Math.max(0, entrada.valorEstornoCentavos);
  const doLote = Math.min(v, Math.max(0, entrada.livreNoLoteCentavos));
  const doVencido = Math.min(v - doLote, Math.max(0, entrada.vencidoDoLoteCentavos));
  return {
    estornarDoLoteCentavos: doLote,
    absorvidoPorVencimentoCentavos: doVencido,
    saldoDevedorCentavos: v - doLote - doVencido,
  };
}

/** Teto mensal de recompensa por prestador. */
export function aplicarTetoMensal(entrada: {
  valorCalculadoCentavos: Centavos;
  jaConcedidoNoMesCentavos: Centavos;
  tetoMensalCentavos: Centavos;
}): { concedidoCentavos: Centavos; excedenteCentavos: Centavos } {
  const restante = Math.max(0, entrada.tetoMensalCentavos - entrada.jaConcedidoNoMesCentavos);
  const concedido = Math.min(entrada.valorCalculadoCentavos, restante);
  return {
    concedidoCentavos: concedido,
    excedenteCentavos: entrada.valorCalculadoCentavos - concedido,
  };
}

/** Ajuste manual exige motivo (mínimo 10 caracteres) e valor inteiro não nulo. */
export function validarAjusteManual(entrada: {
  valorCentavos: number;
  motivo?: string | null;
}): { valido: true } | { valido: false; erro: string } {
  if (!Number.isSafeInteger(entrada.valorCentavos) || entrada.valorCentavos === 0) {
    return {
      valido: false,
      erro: 'valor do ajuste deve ser inteiro em centavos e diferente de zero',
    };
  }
  const motivo = (entrada.motivo ?? '').trim();
  if (motivo.length < 10)
    return { valido: false, erro: 'ajuste manual exige motivo (mínimo 10 caracteres)' };
  return { valido: true };
}

export type EstadoLote = 'PENDENTE' | 'DISPONIVEL' | 'RESGATADO' | 'VENCIDO' | 'ESTORNADO';

export interface LoteSaldo {
  id: string;
  estado: EstadoLote;
  seq: number;
  venceEm: Date | null;
  liberaEm: Date | null;
  /** soma de todos os lançamentos do lote (crédito − débitos − vencimentos − estornos) */
  restanteCentavos: Centavos;
}

export interface ReservaSaldo {
  id: string;
  expiraEm: Date;
  alocacoes: Alocacao[];
}

export interface Saldos {
  disponivelCentavos: Centavos;
  pendenteCentavos: Centavos;
  reservadoCentavos: Centavos;
  devedorCentavos: Centavos;
  lotesLivres: LoteDisponivel[];
  proximoVencimento: { venceEm: Date; valorCentavos: Centavos } | null;
}

/**
 * Fonte única de verdade do saldo (usada pela API dentro do lock da carteira):
 * - reservas com expiraEm ≤ agora não seguram saldo (expiração preguiçosa);
 * - lote DISPONIVEL já vencido só conserva o que está reservado.
 */
export function calcularSaldos(entrada: {
  lotes: readonly LoteSaldo[];
  reservasAtivas: readonly ReservaSaldo[];
  /** soma dos lançamentos sem lote (negativo = saldo devedor) */
  semLoteCentavos: Centavos;
  agora: Date;
}): Saldos {
  const retido = new Map<string, number>();
  for (const r of entrada.reservasAtivas) {
    if (r.expiraEm.getTime() <= entrada.agora.getTime()) continue;
    for (const a of r.alocacoes)
      retido.set(a.loteId, (retido.get(a.loteId) ?? 0) + a.valorCentavos);
  }
  let pendente = 0;
  let reservado = 0;
  const livres: LoteDisponivel[] = [];
  for (const lote of entrada.lotes) {
    if (lote.estado === 'PENDENTE') {
      pendente += Math.max(lote.restanteCentavos, 0);
      continue;
    }
    if (lote.estado !== 'DISPONIVEL' || !lote.venceEm) continue;
    const r = Math.min(retido.get(lote.id) ?? 0, Math.max(lote.restanteCentavos, 0));
    reservado += r;
    const vencido = lote.venceEm.getTime() <= entrada.agora.getTime();
    const livre = vencido ? 0 : Math.max(lote.restanteCentavos - r, 0);
    if (livre > 0)
      livres.push({ id: lote.id, venceEm: lote.venceEm, seq: lote.seq, livreCentavos: livre });
  }
  const ordenados = ordenarFifo(livres);
  const primeiro = ordenados[0];
  const proximoVencimento = primeiro
    ? {
        venceEm: primeiro.venceEm,
        valorCentavos: ordenados
          .filter((l) => l.venceEm.getTime() === primeiro.venceEm.getTime())
          .reduce((a, l) => a + l.livreCentavos, 0),
      }
    : null;
  return {
    disponivelCentavos: ordenados.reduce((a, l) => a + l.livreCentavos, 0),
    pendenteCentavos: pendente,
    reservadoCentavos: reservado,
    devedorCentavos: Math.max(0, -entrada.semLoteCentavos),
    lotesLivres: ordenados,
    proximoVencimento,
  };
}
