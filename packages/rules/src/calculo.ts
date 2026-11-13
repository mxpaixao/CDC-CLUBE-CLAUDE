import {
  AcumuladorBps,
  type Bps,
  type Centavos,
  type EscopoRegra,
  type NivelPrestador,
  type ParametrosSobrescrita,
  type PerfilComercial,
  exigirCentavos,
  ratearProporcional,
} from '@cdc/shared';
import { acumula, type ConfiguracaoVigente, type Vigente } from './configuracao';

export type TipoItem = 'MERCADORIA' | 'SERVICO' | 'FRETE';

export interface ItemCalculo {
  /** Identificador estável do item dentro da venda (ex.: número do item no ERP). */
  id: string;
  sku: string;
  familia?: string | null;
  subfamilia?: string | null;
  tipo: TipoItem;
  valorBrutoCentavos: Centavos;
  descontoCentavos: Centavos;
  custoCentavos?: Centavos | null;
  emPromocao?: boolean;
  descontoNegociado?: boolean;
  tabelaProfissional?: boolean;
}

export interface VendaCalculo {
  lojaId: string;
  canal: string;
  /** Instante de confirmação da venda (define a configuração vigente usada). */
  instante: Date;
  perfil: PerfilComercial;
  itens: ItemCalculo[];
  /** Parcela da venda paga com saldo do Clube (nunca gera novo crédito). */
  pagoComCashbackCentavos: Centavos;
  /** Comprador é participante ativo do Clube? (Não participante não gera cashback.) */
  compradorParticipante: boolean;
  /** 1ª compra elegível após a adesão (determinado pela API a partir do histórico). */
  boasVindas: boolean;
  /** Indicação de prestador, se houver (validada pela antifraude antes). */
  indicacao?: { nivel: NivelPrestador; bloqueio?: string | null } | null;
}

export type EscopoFonte = EscopoRegra | 'NIVEL' | 'MATRIZ' | 'NAO_APLICAVEL';

export interface FonteRegra {
  escopo: EscopoFonte;
  regraVersaoId: string | null;
  descricao: string;
}

export interface ItemResultado {
  id: string;
  sku: string;
  familia: string | null;
  subfamilia: string | null;
  tipo: TipoItem;
  valorBrutoCentavos: Centavos;
  descontoCentavos: Centavos;
  valorLiquidoCentavos: Centavos;
  custoCentavos: Centavos | null;
  cashbackUtilizadoCentavos: Centavos;
  baseCentavos: Centavos;
  cashbackBps: Bps;
  cashbackFonte: FonteRegra;
  boasVindasAplicada: boolean;
  indicacaoBps: Bps;
  indicacaoFonte: FonteRegra;
}

export type OrigemCredito = 'COMPRA' | 'BOAS_VINDAS' | 'CAMPANHA';

export type MotivoSemCashback =
  | 'NAO_PARTICIPANTE'
  | 'ABAIXO_MINIMO'
  | 'SEM_ITENS_ELEGIVEIS'
  | 'PERFIL_SEM_CASHBACK';

export type MotivoSemIndicacao =
  | 'SEM_INDICACAO'
  | 'BLOQUEADA'
  | 'ABAIXO_MINIMO'
  | 'SEM_ITENS_ELEGIVEIS';

export interface ResultadoCalculo {
  perfil: PerfilComercial;
  instante: string;
  mercadoriasLiquidoCentavos: Centavos;
  excluidoFreteServicosCentavos: Centavos;
  pagoComCashbackConsideradoCentavos: Centavos;
  baseCalculoCentavos: Centavos;
  cashback: {
    valorCentavos: Centavos;
    /** soma exata de base × bps (1/10000 de centavo), antes do floor */
    brutoDecimilesimos: string;
    origem: OrigemCredito;
    boasVindasAplicada: boolean;
    compraMinimaCentavos: Centavos;
    motivoZero: MotivoSemCashback | null;
  };
  indicacao: {
    nivel: NivelPrestador | null;
    valorCentavos: Centavos;
    brutoDecimilesimos: string;
    compraMinimaCentavos: Centavos;
    motivoZero: MotivoSemIndicacao | null;
    bloqueio: string | null;
  };
  /** Versão da regra geral do perfil — gravada em Lancamento.regraVersaoId. */
  regraVersaoPerfilId: string;
  regraVersaoProgramaId: string;
  /** Todas as versões de regra que influenciaram o cálculo. */
  regrasUtilizadas: string[];
  itens: ItemResultado[];
}

const NAO_APLICAVEL: FonteRegra = {
  escopo: 'NAO_APLICAVEL',
  regraVersaoId: null,
  descricao: 'não se aplica',
};

function fonte<P>(v: Vigente<P>, descricao: string): FonteRegra {
  return { escopo: v.escopo, regraVersaoId: v.regraVersaoId, descricao };
}

function perfilCasa(v: Vigente<unknown>, perfil: PerfilComercial): boolean {
  return v.filtros.perfil === null || v.filtros.perfil === perfil;
}

/** Sobrescritas candidatas para um item, da mais específica para a mais geral (sem campanha). */
function sobrescritasDoItem(
  config: ConfiguracaoVigente,
  venda: VendaCalculo,
  item: ItemCalculo,
): {
  produto: Vigente<ParametrosSobrescrita>[];
  subfamilia: Vigente<ParametrosSobrescrita>[];
  familia: Vigente<ParametrosSobrescrita>[];
  lojaCanal: Vigente<ParametrosSobrescrita>[];
} {
  const doPerfil = config.sobrescritas.filter((s) => perfilCasa(s, venda.perfil));
  const lojaCanal = doPerfil
    .filter(
      (s) =>
        s.escopo === 'LOJA_CANAL' &&
        (s.filtros.lojaId === null || s.filtros.lojaId === venda.lojaId) &&
        (s.filtros.canal === null || s.filtros.canal === venda.canal) &&
        (s.filtros.lojaId !== null || s.filtros.canal !== null),
    )
    // loja+canal > loja > canal
    .sort((a, b) => especificidadeLojaCanal(b) - especificidadeLojaCanal(a));
  return {
    produto: doPerfil.filter((s) => s.escopo === 'PRODUTO' && s.filtros.sku === item.sku),
    subfamilia: doPerfil.filter(
      (s) =>
        s.escopo === 'SUBFAMILIA' && !!item.subfamilia && s.filtros.subfamilia === item.subfamilia,
    ),
    familia: doPerfil.filter(
      (s) => s.escopo === 'FAMILIA' && !!item.familia && s.filtros.familia === item.familia,
    ),
    lojaCanal,
  };
}

function especificidadeLojaCanal(s: Vigente<ParametrosSobrescrita>): number {
  return (s.filtros.lojaId ? 2 : 0) + (s.filtros.canal ? 1 : 0);
}

function campanhaDoItem(config: ConfiguracaoVigente, venda: VendaCalculo, item: ItemCalculo) {
  const candidatas = config.campanhas.filter((c) => {
    const p = c.parametros;
    if (!perfilCasa(c, venda.perfil)) return false;
    if (p.lojas.length && !p.lojas.includes(venda.lojaId)) return false;
    if (p.canais.length && !p.canais.includes(venda.canal)) return false;
    const temCategoria = p.familias.length || p.subfamilias.length || p.skus.length;
    if (!temCategoria) return true;
    return (
      (!!item.familia && p.familias.includes(item.familia)) ||
      (!!item.subfamilia && p.subfamilias.includes(item.subfamilia)) ||
      p.skus.includes(item.sku)
    );
  });
  // sobreposição de campanhas: vale a de maior percentual (D-010)
  return candidatas.sort((a, b) => b.parametros.cashbackBps - a.parametros.cashbackBps);
}

interface Resolucao {
  bps: Bps;
  fonte: FonteRegra;
}

/**
 * Precedência do cashback (mais específica → mais geral):
 * produto > subfamília > família > campanha ativa > loja/canal > regra geral do perfil.
 * Em cada nível, só conta a regra que define o cashback (elegivel=false conta como 0%).
 */
function resolverCashbackItem(
  config: ConfiguracaoVigente,
  venda: VendaCalculo,
  item: ItemCalculo,
): Resolucao {
  const perfil = config.perfis[venda.perfil];
  const matriz = config.matriz.parametros;

  if (item.tabelaProfissional && !acumula(matriz, 'TABELA_PROFISSIONAL', 'CASHBACK')) {
    return { bps: 0, fonte: fonte(config.matriz, 'tabela profissional não acumula com cashback') };
  }
  if (item.emPromocao && !acumula(matriz, 'PROMOCAO', 'CASHBACK')) {
    return { bps: 0, fonte: fonte(config.matriz, 'promoção não acumula com cashback') };
  }
  if (item.descontoNegociado && !acumula(matriz, 'DESCONTO_NEGOCIADO', 'CASHBACK')) {
    return { bps: 0, fonte: fonte(config.matriz, 'desconto negociado não acumula com cashback') };
  }
  if (venda.indicacao && !venda.indicacao.bloqueio && !acumula(matriz, 'INDICACAO', 'CASHBACK')) {
    return {
      bps: 0,
      fonte: fonte(config.matriz, 'indicação não acumula com cashback do comprador'),
    };
  }

  const geral: Resolucao = {
    bps: perfil.parametros.cashbackBps,
    fonte: fonte(perfil, `regra geral ${venda.perfil}`),
  };
  if (!perfil.parametros.aceitaSobrescritas) return geral;

  const s = sobrescritasDoItem(config, venda, item);
  const niveis: [Vigente<ParametrosSobrescrita>[], string][] = [
    [s.produto, `SKU ${item.sku}`],
    [s.subfamilia, `subfamília ${item.subfamilia}`],
    [s.familia, `família ${item.familia}`],
  ];
  for (const [lista, desc] of niveis) {
    const r = primeiraQueDefineCashback(lista, desc);
    if (r) return r;
  }
  for (const campanha of campanhaDoItem(config, venda, item)) {
    if (item.emPromocao && !campanha.parametros.acumulaComPromocao) continue; // cai para o próximo nível
    return {
      bps: campanha.parametros.cashbackBps,
      fonte: fonte(campanha, `campanha ${campanha.nome ?? campanha.regraId}`),
    };
  }
  const r = primeiraQueDefineCashback(s.lojaCanal, 'loja/canal');
  return r ?? geral;
}

function primeiraQueDefineCashback(
  lista: Vigente<ParametrosSobrescrita>[],
  desc: string,
): Resolucao | null {
  for (const s of lista) {
    if (s.parametros.elegivel === false) return { bps: 0, fonte: fonte(s, `${desc} não elegível`) };
    if (s.parametros.cashbackBps !== undefined)
      return { bps: s.parametros.cashbackBps, fonte: fonte(s, desc) };
  }
  return null;
}

/** Precedência da recompensa de indicação: produto > subfamília > família > loja/canal > nível do prestador. */
function resolverIndicacaoItem(
  config: ConfiguracaoVigente,
  venda: VendaCalculo,
  item: ItemCalculo,
  nivel: NivelPrestador,
): Resolucao {
  const matriz = config.matriz.parametros;
  if (item.tabelaProfissional && !acumula(matriz, 'TABELA_PROFISSIONAL', 'INDICACAO')) {
    return { bps: 0, fonte: fonte(config.matriz, 'tabela profissional não acumula com indicação') };
  }
  if (item.emPromocao && !acumula(matriz, 'PROMOCAO', 'INDICACAO')) {
    return { bps: 0, fonte: fonte(config.matriz, 'promoção não acumula com indicação') };
  }
  if (item.descontoNegociado && !acumula(matriz, 'DESCONTO_NEGOCIADO', 'INDICACAO')) {
    return { bps: 0, fonte: fonte(config.matriz, 'desconto negociado não acumula com indicação') };
  }
  const s = sobrescritasDoItem(config, venda, item);
  const niveis: [Vigente<ParametrosSobrescrita>[], string][] = [
    [s.produto, `SKU ${item.sku}`],
    [s.subfamilia, `subfamília ${item.subfamilia}`],
    [s.familia, `família ${item.familia}`],
    [s.lojaCanal, 'loja/canal'],
  ];
  for (const [lista, desc] of niveis) {
    for (const r of lista) {
      if (r.parametros.elegivel === false || r.parametros.elegivelIndicacao === false) {
        return { bps: 0, fonte: fonte(r, `${desc} não elegível para indicação`) };
      }
      if (r.parametros.indicacaoBps !== undefined)
        return { bps: r.parametros.indicacaoBps, fonte: fonte(r, desc) };
    }
  }
  const programa = config.programa;
  return {
    bps: programa.parametros.indicacao.bpsPorNivel[nivel],
    fonte: { ...fonte(programa, `nível ${nivel}`), escopo: 'NIVEL' },
  };
}

/** Percentual com boas-vindas: max(original, min(original × multiplicador, teto)). */
export function aplicarBoasVindas(bps: Bps, multiplicadorPct: number, tetoBps: Bps): Bps {
  if (bps <= 0) return 0;
  const dobrado = Math.floor((bps * multiplicadorPct) / 100);
  return Math.max(bps, Math.min(dobrado, tetoBps));
}

/**
 * Calcula cashback do comprador e recompensa do prestador de UMA venda.
 * Base de cálculo = mercadorias após descontos − frete − serviços − parcela paga com cashback.
 * A parcela paga com cashback é rateada entre as mercadorias proporcionalmente ao valor líquido.
 */
export function calcularVenda(venda: VendaCalculo, config: ConfiguracaoVigente): ResultadoCalculo {
  exigirCentavos(venda.pagoComCashbackCentavos, 'pagoComCashbackCentavos');
  if (venda.pagoComCashbackCentavos < 0)
    throw new Error('pagoComCashbackCentavos não pode ser negativo');
  for (const item of venda.itens) {
    exigirCentavos(item.valorBrutoCentavos, `item ${item.id} valorBruto`);
    exigirCentavos(item.descontoCentavos, `item ${item.id} desconto`);
    if (
      item.valorBrutoCentavos < 0 ||
      item.descontoCentavos < 0 ||
      item.descontoCentavos > item.valorBrutoCentavos
    ) {
      throw new Error(
        `item ${item.id}: valores inválidos (bruto ${item.valorBrutoCentavos}, desconto ${item.descontoCentavos})`,
      );
    }
  }

  const perfil = config.perfis[venda.perfil];
  const programa = config.programa;
  const mercadorias = venda.itens.filter((i) => i.tipo === 'MERCADORIA');
  const liquidos = mercadorias.map((i) => i.valorBrutoCentavos - i.descontoCentavos);
  const totalMercadorias = liquidos.reduce((a, b) => a + b, 0);
  const excluido = venda.itens
    .filter((i) => i.tipo !== 'MERCADORIA')
    .reduce((acc, i) => acc + i.valorBrutoCentavos - i.descontoCentavos, 0);
  const pagoCashback = Math.min(venda.pagoComCashbackCentavos, totalMercadorias);
  const rateio =
    totalMercadorias > 0 ? ratearProporcional(pagoCashback, liquidos) : liquidos.map(() => 0);

  const indicacaoAtiva = !!venda.indicacao && !venda.indicacao.bloqueio;
  const bv = perfil.parametros.boasVindas;
  const aplicarBv = venda.boasVindas && !!bv;

  const acCashback = new AcumuladorBps();
  const acIndicacao = new AcumuladorBps();
  const usadas = new Set<string>([
    perfil.regraVersaoId,
    programa.regraVersaoId,
    config.matriz.regraVersaoId,
  ]);
  let houveBoasVindas = false;
  let houveCampanha = false;

  const itens: ItemResultado[] = venda.itens.map((item) => {
    const liquido = item.valorBrutoCentavos - item.descontoCentavos;
    const base = {
      id: item.id,
      sku: item.sku,
      familia: item.familia ?? null,
      subfamilia: item.subfamilia ?? null,
      tipo: item.tipo,
      valorBrutoCentavos: item.valorBrutoCentavos,
      descontoCentavos: item.descontoCentavos,
      valorLiquidoCentavos: liquido,
      custoCentavos: item.custoCentavos ?? null,
    };
    if (item.tipo !== 'MERCADORIA') {
      const desc = {
        ...NAO_APLICAVEL,
        descricao: item.tipo === 'FRETE' ? 'frete fora da base' : 'serviço fora da base',
      };
      return {
        ...base,
        cashbackUtilizadoCentavos: 0,
        baseCentavos: 0,
        cashbackBps: 0,
        cashbackFonte: desc,
        boasVindasAplicada: false,
        indicacaoBps: 0,
        indicacaoFonte: desc,
      };
    }
    const idx = mercadorias.indexOf(item);
    const utilizado = rateio[idx];
    const baseItem = liquido - utilizado;

    const cb = resolverCashbackItem(config, venda, item);
    let cashbackBps = cb.bps;
    let bvItem = false;
    if (aplicarBv && cashbackBps > 0) {
      const novo = aplicarBoasVindas(cashbackBps, bv.multiplicadorPct, bv.tetoBps);
      bvItem = novo > cashbackBps;
      cashbackBps = novo;
    }
    if (cb.fonte.regraVersaoId) usadas.add(cb.fonte.regraVersaoId);

    let ind: Resolucao = { bps: 0, fonte: { ...NAO_APLICAVEL, descricao: 'sem indicação' } };
    if (indicacaoAtiva) {
      ind = resolverIndicacaoItem(config, venda, item, venda.indicacao!.nivel);
      if (ind.fonte.regraVersaoId) usadas.add(ind.fonte.regraVersaoId);
    }

    if (baseItem > 0) {
      acCashback.adicionar(baseItem, cashbackBps);
      acIndicacao.adicionar(baseItem, ind.bps);
      if (cashbackBps > 0 && bvItem) houveBoasVindas = true;
      if (cashbackBps > 0 && cb.fonte.escopo === 'CAMPANHA') houveCampanha = true;
    }
    return {
      ...base,
      cashbackUtilizadoCentavos: utilizado,
      baseCentavos: baseItem,
      cashbackBps,
      cashbackFonte: cb.fonte,
      boasVindasAplicada: bvItem,
      indicacaoBps: ind.bps,
      indicacaoFonte: ind.fonte,
    };
  });

  const baseCalculo = itens.reduce((a, i) => a + i.baseCentavos, 0);

  // ---- cashback do comprador
  const compraMinima = perfil.parametros.compraMinimaCentavos;
  let cashbackValor = acCashback.resultadoFloor();
  let motivoCashback: MotivoSemCashback | null = null;
  if (!venda.compradorParticipante) motivoCashback = 'NAO_PARTICIPANTE';
  else if (perfil.parametros.cashbackBps === 0 && !perfil.parametros.aceitaSobrescritas)
    motivoCashback = 'PERFIL_SEM_CASHBACK';
  else if (baseCalculo < compraMinima) motivoCashback = 'ABAIXO_MINIMO';
  else if (cashbackValor === 0) motivoCashback = 'SEM_ITENS_ELEGIVEIS';
  if (motivoCashback) cashbackValor = 0;

  // ---- recompensa de indicação (teto mensal é aplicado depois, com o acumulado do mês)
  const minimaIndicacao = programa.parametros.indicacao.compraMinimaCentavos;
  let indicacaoValor = acIndicacao.resultadoFloor();
  let motivoIndicacao: MotivoSemIndicacao | null = null;
  if (!venda.indicacao) motivoIndicacao = 'SEM_INDICACAO';
  else if (venda.indicacao.bloqueio) motivoIndicacao = 'BLOQUEADA';
  else if (baseCalculo < minimaIndicacao) motivoIndicacao = 'ABAIXO_MINIMO';
  else if (indicacaoValor === 0) motivoIndicacao = 'SEM_ITENS_ELEGIVEIS';
  if (motivoIndicacao) indicacaoValor = 0;

  const origem: OrigemCredito =
    houveBoasVindas && cashbackValor > 0
      ? 'BOAS_VINDAS'
      : houveCampanha && cashbackValor > 0
        ? 'CAMPANHA'
        : 'COMPRA';

  return {
    perfil: venda.perfil,
    instante: venda.instante.toISOString(),
    mercadoriasLiquidoCentavos: totalMercadorias,
    excluidoFreteServicosCentavos: excluido,
    pagoComCashbackConsideradoCentavos: pagoCashback,
    baseCalculoCentavos: baseCalculo,
    cashback: {
      valorCentavos: cashbackValor,
      brutoDecimilesimos: acCashback.bruto().toString(),
      origem,
      boasVindasAplicada: houveBoasVindas && cashbackValor > 0,
      compraMinimaCentavos: compraMinima,
      motivoZero: motivoCashback,
    },
    indicacao: {
      nivel: venda.indicacao?.nivel ?? null,
      valorCentavos: indicacaoValor,
      brutoDecimilesimos: acIndicacao.bruto().toString(),
      compraMinimaCentavos: minimaIndicacao,
      motivoZero: motivoIndicacao,
      bloqueio: venda.indicacao?.bloqueio ?? null,
    },
    regraVersaoPerfilId: perfil.regraVersaoId,
    regraVersaoProgramaId: programa.regraVersaoId,
    regrasUtilizadas: [...usadas],
    itens,
  };
}
