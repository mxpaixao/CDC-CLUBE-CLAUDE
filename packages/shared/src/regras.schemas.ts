import { z } from 'zod';

/**
 * Schemas dos parâmetros de regra (RegraVersao.parametros), por escopo.
 * Nenhum valor comercial vive no código: o seed v1 apenas PREENCHE estes schemas.
 */

export const PERFIS_COMERCIAIS = ['CLIENTE_CPF', 'CLIENTE_EMPRESA', 'PRESTADOR'] as const;
export type PerfilComercial = (typeof PERFIS_COMERCIAIS)[number];

export const NIVEIS_PRESTADOR = ['BRONZE', 'PRATA', 'OURO'] as const;
export type NivelPrestador = (typeof NIVEIS_PRESTADOR)[number];

export const TIPOS_CARTEIRA = ['CLIENTE', 'PRESTADOR'] as const;
export type TipoCarteira = (typeof TIPOS_CARTEIRA)[number];

export const ESCOPOS_REGRA = [
  'PROGRAMA',
  'PERFIL',
  'LOJA_CANAL',
  'CAMPANHA',
  'FAMILIA',
  'SUBFAMILIA',
  'PRODUTO',
  'MATRIZ',
  'PISO_MARGEM',
  'NIVEL_PRESTADOR',
] as const;
export type EscopoRegra = (typeof ESCOPOS_REGRA)[number];

/** Elementos da matriz de combinações. */
export const ELEMENTOS_COMBINACAO = [
  'CASHBACK',
  'PROMOCAO',
  'DESCONTO_NEGOCIADO',
  'TABELA_PROFISSIONAL',
  'INDICACAO',
] as const;
export type ElementoCombinacao = (typeof ELEMENTOS_COMBINACAO)[number];

const centavos = z.number().int().min(0);
const bps = z.number().int().min(0).max(10_000);
const dias = z.number().int().min(0).max(3650);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const parametrosCarteiraSchema = z.object({
  carenciaDias: dias,
  validadeDias: dias.min(1),
  limiteUsoBps: bps,
  saldoMinimoResgateCentavos: centavos,
  exigeAutenticacaoTitular: z.boolean(),
});
export type ParametrosCarteira = z.infer<typeof parametrosCarteiraSchema>;

/** Escopo PROGRAMA: parâmetros gerais (uma regra única). */
export const parametrosProgramaSchema = z.object({
  carteiras: z.object({ CLIENTE: parametrosCarteiraSchema, PRESTADOR: parametrosCarteiraSchema }),
  reservaTtlMinutos: z
    .number()
    .int()
    .min(1)
    .max(24 * 60),
  indicacao: z.object({
    bpsPorNivel: z.object({ BRONZE: bps, PRATA: bps, OURO: bps }),
    vinculoDias: dias.min(1),
    tetoMensalCentavos: centavos,
    compraMinimaCentavos: centavos,
  }),
  devolucao: z.object({
    /** Recalcular aplicando a compra mínima sobre o valor remanescente (D-012). */
    aplicarCompraMinimaNoRecalculo: z.boolean(),
    /** Devolver à carteira a parcela de cashback usada nos itens devolvidos (D-013). */
    recreditarCashbackUtilizado: z.boolean(),
  }),
  antifraude: z.object({
    janelaDias: dias.min(1),
    maxVendasMesmoCompradorNaJanela: z.number().int().min(1),
    maxValoresRedondosNaJanela: z.number().int().min(1),
    valorRedondoMultiploCentavos: centavos.min(100),
    maxPercentualCanceladasBps: bps,
    minimoVendasParaAvaliarCancelamento: z.number().int().min(1),
  }),
  comunicacao: z.object({
    horarioComercial: z.object({
      inicio: hhmm,
      fim: hhmm,
      diasSemana: z.array(z.number().int().min(1).max(7)).min(1),
    }),
    diasAvisoVencimento: dias,
    diasReativacao: dias.min(1),
  }),
  conciliacao: z.object({
    /** Horas sem importação bem-sucedida para entrar em contingência. */
    horasSemImportacaoParaContingencia: z.number().int().min(1),
    /** Dias para uma reserva confirmada aparecer em venda importada antes de virar divergência. */
    diasToleranciaReservaSemVenda: dias,
  }),
  /** Códigos de tabela de preço do ERP considerados "tabela profissional / meio de campo". */
  tabelasPrecoProfissionais: z.array(z.string().min(1)),
});
export type ParametrosPrograma = z.infer<typeof parametrosProgramaSchema>;

/** Escopo PERFIL: regra geral de cada perfil comercial. */
export const parametrosPerfilSchema = z.object({
  cashbackBps: bps,
  compraMinimaCentavos: centavos,
  boasVindas: z
    .object({
      /** multiplicador × 100 (200 = em dobro) */
      multiplicadorPct: z.number().int().min(100).max(1000),
      /** teto do percentual com boas-vindas */
      tetoBps: bps,
    })
    .nullable(),
  /** Se false, regras de família/SKU/campanha/loja não alteram o cashback deste perfil. */
  aceitaSobrescritas: z.boolean(),
});
export type ParametrosPerfil = z.infer<typeof parametrosPerfilSchema>;

/** Escopos LOJA_CANAL, FAMILIA, SUBFAMILIA, PRODUTO: sobrescritas. */
export const parametrosSobrescritaSchema = z
  .object({
    /** false = não elegível (0%) para cashback e indicação */
    elegivel: z.boolean().default(true),
    cashbackBps: bps.optional(),
    /** percentual próprio de recompensa de indicação (substitui o do nível) */
    indicacaoBps: bps.optional(),
    /** false = item não gera recompensa de indicação */
    elegivelIndicacao: z.boolean().optional(),
  })
  .refine(
    (p) =>
      p.elegivel === false ||
      p.cashbackBps !== undefined ||
      p.indicacaoBps !== undefined ||
      p.elegivelIndicacao !== undefined,
    {
      message:
        'sobrescrita precisa definir elegivel=false, cashbackBps, indicacaoBps ou elegivelIndicacao',
    },
  );
export type ParametrosSobrescrita = z.infer<typeof parametrosSobrescritaSchema>;

/** Escopo CAMPANHA. */
export const parametrosCampanhaSchema = z.object({
  cashbackBps: bps,
  familias: z.array(z.string()).default([]),
  subfamilias: z.array(z.string()).default([]),
  skus: z.array(z.string()).default([]),
  lojas: z.array(z.string()).default([]),
  canais: z.array(z.string()).default([]),
  /** "promoção acumula com cashback salvo se a campanha disser o contrário" */
  acumulaComPromocao: z.boolean().default(true),
});
export type ParametrosCampanha = z.infer<typeof parametrosCampanhaSchema>;

export const parametrosMatrizSchema = z.object({
  pares: z
    .array(
      z.object({
        a: z.enum(ELEMENTOS_COMBINACAO),
        b: z.enum(ELEMENTOS_COMBINACAO),
        acumula: z.boolean(),
      }),
    )
    .min(1),
});
export type ParametrosMatriz = z.infer<typeof parametrosMatrizSchema>;

/** Escopo PISO_MARGEM (por família). Fase 1: só alerta, não bloqueia. */
export const parametrosPisoMargemSchema = z
  .object({
    /** máximo de (descontos + cashback + indicação) sobre o valor bruto */
    concessaoMaximaBps: bps.optional(),
    /** margem mínima após concessões, quando o arquivo do ERP traz custo */
    margemMinimaBps: bps.optional(),
  })
  .refine((p) => p.concessaoMaximaBps !== undefined || p.margemMinimaBps !== undefined, {
    message: 'informe concessaoMaximaBps e/ou margemMinimaBps',
  });
export type ParametrosPisoMargem = z.infer<typeof parametrosPisoMargemSchema>;

export const parametrosNivelPrestadorSchema = z.object({
  automatico: z.boolean(),
  janelaDias: dias.min(1),
  criterios: z.array(
    z.object({
      nivel: z.enum(NIVEIS_PRESTADOR),
      volumeIndicadoMinimoCentavos: centavos,
      vendasIndicadasMinimas: z.number().int().min(0),
    }),
  ),
});
export type ParametrosNivelPrestador = z.infer<typeof parametrosNivelPrestadorSchema>;

export const schemaPorEscopo: Record<EscopoRegra, z.ZodTypeAny> = {
  PROGRAMA: parametrosProgramaSchema,
  PERFIL: parametrosPerfilSchema,
  LOJA_CANAL: parametrosSobrescritaSchema,
  CAMPANHA: parametrosCampanhaSchema,
  FAMILIA: parametrosSobrescritaSchema,
  SUBFAMILIA: parametrosSobrescritaSchema,
  PRODUTO: parametrosSobrescritaSchema,
  MATRIZ: parametrosMatrizSchema,
  PISO_MARGEM: parametrosPisoMargemSchema,
  NIVEL_PRESTADOR: parametrosNivelPrestadorSchema,
};

export function validarParametros(escopo: EscopoRegra, parametros: unknown) {
  return schemaPorEscopo[escopo].parse(parametros);
}
