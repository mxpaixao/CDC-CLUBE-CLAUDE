import {
  type EscopoRegra,
  type ElementoCombinacao,
  type ParametrosCampanha,
  type ParametrosMatriz,
  type ParametrosNivelPrestador,
  type ParametrosPerfil,
  type ParametrosPisoMargem,
  type ParametrosPrograma,
  type ParametrosSobrescrita,
  type PerfilComercial,
  PERFIS_COMERCIAIS,
  validarParametros,
} from '@cdc/shared';

/** Uma versão de regra como vem do banco (Regra + RegraVersao). */
export interface VersaoRegraEntrada {
  regraVersaoId: string;
  regraId: string;
  escopo: EscopoRegra;
  versao: number;
  nome?: string | null;
  perfil?: PerfilComercial | null;
  lojaId?: string | null;
  canal?: string | null;
  familia?: string | null;
  subfamilia?: string | null;
  sku?: string | null;
  campanhaId?: string | null;
  vigenciaInicio: Date;
  vigenciaFim?: Date | null;
  /** false = a regra deixa de valer a partir desta versão (desativação versionada). */
  ativa?: boolean;
  parametros: unknown;
}

export interface FiltrosRegra {
  perfil: PerfilComercial | null;
  lojaId: string | null;
  canal: string | null;
  familia: string | null;
  subfamilia: string | null;
  sku: string | null;
  campanhaId: string | null;
}

export interface Vigente<P> {
  regraVersaoId: string;
  regraId: string;
  escopo: EscopoRegra;
  versao: number;
  nome: string | null;
  vigenciaInicio: Date;
  vigenciaFim: Date | null;
  filtros: FiltrosRegra;
  parametros: P;
}

export interface ConfiguracaoVigente {
  instante: Date;
  programa: Vigente<ParametrosPrograma>;
  perfis: Record<PerfilComercial, Vigente<ParametrosPerfil>>;
  sobrescritas: Vigente<ParametrosSobrescrita>[];
  campanhas: Vigente<ParametrosCampanha>[];
  matriz: Vigente<ParametrosMatriz>;
  pisos: Vigente<ParametrosPisoMargem>[];
  nivel: Vigente<ParametrosNivelPrestador> | null;
}

export class ErroConfiguracao extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroConfiguracao';
  }
}

function vigenteEm(v: VersaoRegraEntrada, instante: Date): boolean {
  return (
    v.vigenciaInicio.getTime() <= instante.getTime() &&
    (!v.vigenciaFim || instante.getTime() < v.vigenciaFim.getTime())
  );
}

/**
 * Escolhe, para cada regra, a versão vigente no instante: a de maior início de vigência
 * (empate: maior número de versão). Versões antigas nunca são alteradas — editar uma regra
 * cria nova versão (docs/DECISOES.md · D-008).
 */
export function selecionarVersoesVigentes(
  versoes: readonly VersaoRegraEntrada[],
  instante: Date,
): VersaoRegraEntrada[] {
  const porRegra = new Map<string, VersaoRegraEntrada>();
  for (const v of versoes) {
    if (!vigenteEm(v, instante)) continue;
    const atual = porRegra.get(v.regraId);
    if (
      !atual ||
      v.vigenciaInicio.getTime() > atual.vigenciaInicio.getTime() ||
      (v.vigenciaInicio.getTime() === atual.vigenciaInicio.getTime() && v.versao > atual.versao)
    ) {
      porRegra.set(v.regraId, v);
    }
  }
  return [...porRegra.values()].filter((v) => v.ativa !== false);
}

function paraVigente<P>(v: VersaoRegraEntrada): Vigente<P> {
  let parametros: P;
  try {
    parametros = validarParametros(v.escopo, v.parametros) as P;
  } catch (e) {
    throw new ErroConfiguracao(
      `parâmetros inválidos na regra ${v.regraId} v${v.versao} (${v.escopo}): ${(e as Error).message}`,
    );
  }
  return {
    regraVersaoId: v.regraVersaoId,
    regraId: v.regraId,
    escopo: v.escopo,
    versao: v.versao,
    nome: v.nome ?? null,
    vigenciaInicio: v.vigenciaInicio,
    vigenciaFim: v.vigenciaFim ?? null,
    filtros: {
      perfil: v.perfil ?? null,
      lojaId: v.lojaId ?? null,
      canal: v.canal ?? null,
      familia: v.familia ?? null,
      subfamilia: v.subfamilia ?? null,
      sku: v.sku ?? null,
      campanhaId: v.campanhaId ?? null,
    },
    parametros,
  };
}

function unica<P>(lista: VersaoRegraEntrada[], escopo: EscopoRegra, obrigatoria: true): Vigente<P>;
function unica<P>(
  lista: VersaoRegraEntrada[],
  escopo: EscopoRegra,
  obrigatoria: false,
): Vigente<P> | null;
function unica<P>(
  lista: VersaoRegraEntrada[],
  escopo: EscopoRegra,
  obrigatoria: boolean,
): Vigente<P> | null {
  const doEscopo = lista.filter((v) => v.escopo === escopo);
  if (doEscopo.length > 1)
    throw new ErroConfiguracao(`mais de uma regra vigente de escopo ${escopo}`);
  if (doEscopo.length === 0) {
    if (obrigatoria) throw new ErroConfiguracao(`nenhuma regra vigente de escopo ${escopo}`);
    return null;
  }
  return paraVigente<P>(doEscopo[0]);
}

/** Monta a configuração vigente num instante a partir de todas as versões de regra. */
export function resolverConfiguracao(
  versoes: readonly VersaoRegraEntrada[],
  instante: Date,
): ConfiguracaoVigente {
  const vigentes = selecionarVersoesVigentes(versoes, instante);
  const perfisLista = vigentes.filter((v) => v.escopo === 'PERFIL');
  const perfis = {} as Record<PerfilComercial, Vigente<ParametrosPerfil>>;
  for (const perfil of PERFIS_COMERCIAIS) {
    const doPerfil = perfisLista.filter((v) => v.perfil === perfil);
    if (doPerfil.length !== 1) {
      throw new ErroConfiguracao(
        `perfil ${perfil} precisa de exatamente uma regra geral vigente (encontradas: ${doPerfil.length})`,
      );
    }
    perfis[perfil] = paraVigente<ParametrosPerfil>(doPerfil[0]);
  }
  return {
    instante,
    programa: unica<ParametrosPrograma>(vigentes, 'PROGRAMA', true),
    perfis,
    sobrescritas: vigentes
      .filter(
        (v) =>
          v.escopo === 'FAMILIA' ||
          v.escopo === 'SUBFAMILIA' ||
          v.escopo === 'PRODUTO' ||
          v.escopo === 'LOJA_CANAL',
      )
      .map((v) => paraVigente<ParametrosSobrescrita>(v)),
    campanhas: vigentes
      .filter((v) => v.escopo === 'CAMPANHA')
      .map((v) => paraVigente<ParametrosCampanha>(v)),
    matriz: unica<ParametrosMatriz>(vigentes, 'MATRIZ', true),
    pisos: vigentes
      .filter((v) => v.escopo === 'PISO_MARGEM')
      .map((v) => paraVigente<ParametrosPisoMargem>(v)),
    nivel: unica<ParametrosNivelPrestador>(vigentes, 'NIVEL_PRESTADOR', false),
  };
}

/**
 * A matriz é simétrica. Par não configurado = NÃO acumula (padrão que protege a margem — D-009).
 */
export function acumula(
  matriz: ParametrosMatriz,
  a: ElementoCombinacao,
  b: ElementoCombinacao,
): boolean {
  if (a === b) return true;
  const par = matriz.pares.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
  return par ? par.acumula : false;
}
