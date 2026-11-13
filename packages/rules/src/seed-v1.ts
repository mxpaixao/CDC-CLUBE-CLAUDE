import type {
  ParametrosMatriz,
  ParametrosNivelPrestador,
  ParametrosPerfil,
  ParametrosPrograma,
  PerfilComercial,
} from '@cdc/shared';

/**
 * Valores APROVADOS da configuração v1 (seção 3 do escopo). São DADOS de seed:
 * o motor nunca lê estes valores diretamente — eles são gravados em Regra/RegraVersao
 * e passam a ser editados pelo painel.
 */
export const PROGRAMA_V1: ParametrosPrograma = {
  carteiras: {
    CLIENTE: {
      carenciaDias: 7,
      validadeDias: 30,
      limiteUsoBps: 2000,
      saldoMinimoResgateCentavos: 500,
      exigeAutenticacaoTitular: false,
    },
    PRESTADOR: {
      carenciaDias: 7,
      validadeDias: 60,
      limiteUsoBps: 2000,
      saldoMinimoResgateCentavos: 500,
      exigeAutenticacaoTitular: true,
    },
  },
  reservaTtlMinutos: 30,
  indicacao: {
    bpsPorNivel: { BRONZE: 300, PRATA: 400, OURO: 500 },
    vinculoDias: 90,
    tetoMensalCentavos: 100_000,
    compraMinimaCentavos: 5_000,
  },
  devolucao: { aplicarCompraMinimaNoRecalculo: true, recreditarCashbackUtilizado: true },
  antifraude: {
    janelaDias: 30,
    maxVendasMesmoCompradorNaJanela: 8,
    maxValoresRedondosNaJanela: 5,
    valorRedondoMultiploCentavos: 10_000,
    maxPercentualCanceladasBps: 3_000,
    minimoVendasParaAvaliarCancelamento: 5,
  },
  comunicacao: {
    horarioComercial: { inicio: '08:00', fim: '18:00', diasSemana: [1, 2, 3, 4, 5, 6] },
    diasAvisoVencimento: 7,
    diasReativacao: 45,
  },
  conciliacao: { horasSemImportacaoParaContingencia: 48, diasToleranciaReservaSemVenda: 2 },
  tabelasPrecoProfissionais: ['MEIO_DE_CAMPO'],
};

export const PERFIS_V1: Record<PerfilComercial, ParametrosPerfil> = {
  CLIENTE_CPF: {
    cashbackBps: 300,
    compraMinimaCentavos: 5_000,
    boasVindas: { multiplicadorPct: 200, tetoBps: 600 },
    aceitaSobrescritas: true,
  },
  CLIENTE_EMPRESA: {
    cashbackBps: 300,
    compraMinimaCentavos: 5_000,
    boasVindas: { multiplicadorPct: 200, tetoBps: 600 },
    aceitaSobrescritas: true,
  },
  // compra própria do prestador: tabela meio de campo, SEM cashback
  PRESTADOR: {
    cashbackBps: 0,
    compraMinimaCentavos: 0,
    boasVindas: null,
    aceitaSobrescritas: false,
  },
};

export const MATRIZ_V1: ParametrosMatriz = {
  pares: [
    { a: 'TABELA_PROFISSIONAL', b: 'CASHBACK', acumula: false },
    { a: 'INDICACAO', b: 'CASHBACK', acumula: true },
    { a: 'PROMOCAO', b: 'CASHBACK', acumula: true },
    { a: 'DESCONTO_NEGOCIADO', b: 'CASHBACK', acumula: true },
    { a: 'PROMOCAO', b: 'INDICACAO', acumula: true },
    { a: 'DESCONTO_NEGOCIADO', b: 'INDICACAO', acumula: true },
    { a: 'TABELA_PROFISSIONAL', b: 'INDICACAO', acumula: false },
    { a: 'PROMOCAO', b: 'DESCONTO_NEGOCIADO', acumula: true },
  ],
};

/** Critérios de nível: PREPARADOS (automatico=false). Valores a confirmar com a CDC. */
export const NIVEL_PRESTADOR_V1: ParametrosNivelPrestador = {
  automatico: false,
  janelaDias: 90,
  criterios: [
    { nivel: 'BRONZE', volumeIndicadoMinimoCentavos: 0, vendasIndicadasMinimas: 0 },
    { nivel: 'PRATA', volumeIndicadoMinimoCentavos: 1_500_000, vendasIndicadasMinimas: 10 },
    { nivel: 'OURO', volumeIndicadoMinimoCentavos: 5_000_000, vendasIndicadasMinimas: 25 },
  ],
};
