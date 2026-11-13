import { Injectable } from '@nestjs/common';
import { EscopoRegra, PerfilComercial, Prisma } from '@prisma/client';
import {
  type ConfiguracaoVigente,
  type VendaCalculo,
  type VersaoRegraEntrada,
  ErroConfiguracao,
  avaliarPisosMargem,
  calcularVenda,
  gerarRegrasEmLinguagemSimples,
  resolverConfiguracao,
} from '@cdc/rules';
import { validarParametros } from '@cdc/shared';
import { AuditoriaService, type Ator } from '../comum/auditoria.service';
import { ErroNegocio } from '../comum/erros';
import { PrismaService, type Tx } from '../comum/prisma.service';
import { Relogio } from '../comum/relogio';

export interface FiltrosNovaRegra {
  perfil?: PerfilComercial | null;
  lojaId?: string | null;
  canal?: string | null;
  familia?: string | null;
  subfamilia?: string | null;
  sku?: string | null;
  campanhaId?: string | null;
}

export function chaveNaturalRegra(escopo: EscopoRegra, f: FiltrosNovaRegra): string {
  const p = f.perfil ?? '*';
  switch (escopo) {
    case 'PROGRAMA':
    case 'MATRIZ':
    case 'NIVEL_PRESTADOR':
      return escopo;
    case 'PERFIL':
      if (!f.perfil) throw new ErroNegocio('REGRA_INVALIDA', 'regra de perfil exige o perfil', 400);
      return `PERFIL:${f.perfil}`;
    case 'FAMILIA':
      if (!f.familia) throw new ErroNegocio('REGRA_INVALIDA', 'informe a família', 400);
      return `FAMILIA:${f.familia}:${p}`;
    case 'SUBFAMILIA':
      if (!f.subfamilia) throw new ErroNegocio('REGRA_INVALIDA', 'informe a subfamília', 400);
      return `SUBFAMILIA:${f.subfamilia}:${p}`;
    case 'PRODUTO':
      if (!f.sku) throw new ErroNegocio('REGRA_INVALIDA', 'informe o SKU', 400);
      return `PRODUTO:${f.sku}:${p}`;
    case 'LOJA_CANAL':
      if (!f.lojaId && !f.canal)
        throw new ErroNegocio('REGRA_INVALIDA', 'informe loja e/ou canal', 400);
      return `LOJA_CANAL:${f.lojaId ?? '*'}:${f.canal ?? '*'}:${p}`;
    case 'CAMPANHA':
      if (!f.campanhaId) throw new ErroNegocio('REGRA_INVALIDA', 'campanha não informada', 400);
      return `CAMPANHA:${f.campanhaId}`;
    case 'PISO_MARGEM':
      if (!f.familia) throw new ErroNegocio('REGRA_INVALIDA', 'informe a família', 400);
      return `PISO_MARGEM:${f.familia}`;
  }
}

type VersaoComRegra = Prisma.RegraVersaoGetPayload<{ include: { regra: true } }>;

function paraEntrada(v: VersaoComRegra): VersaoRegraEntrada {
  return {
    regraVersaoId: v.id,
    regraId: v.regraId,
    escopo: v.regra.escopo,
    versao: v.versao,
    nome: v.regra.nome,
    perfil: v.regra.perfil,
    lojaId: v.regra.lojaId,
    canal: v.regra.canal,
    familia: v.regra.familia,
    subfamilia: v.regra.subfamilia,
    sku: v.regra.sku,
    campanhaId: v.regra.campanhaId,
    vigenciaInicio: v.vigenciaInicio,
    vigenciaFim: v.vigenciaFim,
    ativa: v.ativa,
    parametros: v.parametros,
  };
}

@Injectable()
export class RegrasService {
  private cache: { assinatura: string; versoes: VersaoRegraEntrada[] } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly relogio: Relogio,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Todas as versões de regra (cache invalidado por qualquer nova versão, inclusive de outro processo). */
  async versoes(tx?: Tx): Promise<VersaoRegraEntrada[]> {
    const cliente = tx ?? this.prisma;
    const agg = await cliente.regraVersao.aggregate({
      _count: { _all: true },
      _max: { criadoEm: true },
    });
    const assinatura = `${agg._count._all}:${agg._max.criadoEm?.toISOString() ?? ''}`;
    if (this.cache?.assinatura === assinatura) return this.cache.versoes;
    const todas = await cliente.regraVersao.findMany({
      include: { regra: true },
      orderBy: [{ regraId: 'asc' }, { versao: 'asc' }],
    });
    const versoes = todas.map(paraEntrada);
    this.cache = { assinatura, versoes };
    return versoes;
  }

  async configuracaoEm(instante: Date, tx?: Tx): Promise<ConfiguracaoVigente> {
    try {
      return resolverConfiguracao(await this.versoes(tx), instante);
    } catch (e) {
      if (e instanceof ErroConfiguracao)
        throw new ErroNegocio('CONFIGURACAO_INVALIDA', e.message, 500);
      throw e;
    }
  }

  async configuracaoAtual() {
    return this.configuracaoEm(this.relogio.agora());
  }

  async listar() {
    const regras = await this.prisma.regra.findMany({
      include: { versoes: { orderBy: { versao: 'desc' } } },
      orderBy: [{ escopo: 'asc' }, { chave: 'asc' }],
    });
    const config = await this.configuracaoAtual();
    const vigentes = new Set<string>([
      config.programa.regraVersaoId,
      config.matriz.regraVersaoId,
      ...Object.values(config.perfis).map((p) => p.regraVersaoId),
      ...config.sobrescritas.map((s) => s.regraVersaoId),
      ...config.campanhas.map((s) => s.regraVersaoId),
      ...config.pisos.map((s) => s.regraVersaoId),
      ...(config.nivel ? [config.nivel.regraVersaoId] : []),
    ]);
    return regras.map((r) => ({
      ...r,
      versoes: r.versoes.map((v) => ({ ...v, vigente: vigentes.has(v.id) })),
    }));
  }

  /**
   * Cria nova versão de uma regra (nunca altera versões existentes).
   * Vigência retroativa não é permitida: o histórico calculado continua reproduzível.
   */
  async criarVersao(
    entrada: {
      escopo: EscopoRegra;
      filtros: FiltrosNovaRegra;
      nome?: string | null;
      parametros: unknown;
      vigenciaInicio?: Date | null;
      vigenciaFim?: Date | null;
      ativa?: boolean;
      motivo: string;
    },
    ator: Ator,
    txExterna?: Tx,
  ) {
    const agora = this.relogio.agora();
    const inicio = entrada.vigenciaInicio ?? agora;
    if (inicio.getTime() < agora.getTime() - 60_000) {
      throw new ErroNegocio('VIGENCIA_RETROATIVA', 'a vigência não pode começar no passado', 400);
    }
    if (entrada.vigenciaFim && entrada.vigenciaFim.getTime() <= inicio.getTime()) {
      throw new ErroNegocio(
        'VIGENCIA_INVALIDA',
        'o fim da vigência deve ser depois do início',
        400,
      );
    }
    if (!entrada.motivo || entrada.motivo.trim().length < 5) {
      throw new ErroNegocio('MOTIVO_OBRIGATORIO', 'informe o motivo da alteração', 400);
    }
    let parametros: unknown;
    try {
      parametros = validarParametros(entrada.escopo, entrada.parametros);
    } catch (e) {
      throw new ErroNegocio('PARAMETROS_INVALIDOS', (e as Error).message, 400);
    }
    const chave = chaveNaturalRegra(entrada.escopo, entrada.filtros);
    const executar = async (tx: Tx) => {
      const regra =
        (await tx.regra.findUnique({ where: { chave } })) ??
        (await tx.regra.create({
          data: {
            escopo: entrada.escopo,
            chave,
            nome: entrada.nome ?? null,
            perfil: entrada.filtros.perfil ?? null,
            lojaId: entrada.filtros.lojaId ?? null,
            canal: entrada.filtros.canal ?? null,
            familia: entrada.filtros.familia ?? null,
            subfamilia: entrada.filtros.subfamilia ?? null,
            sku: entrada.filtros.sku ?? null,
            campanhaId: entrada.filtros.campanhaId ?? null,
          },
        }));
      const anterior = await tx.regraVersao.findFirst({
        where: { regraId: regra.id },
        orderBy: { versao: 'desc' },
      });
      const versao = await tx.regraVersao.create({
        data: {
          regraId: regra.id,
          versao: (anterior?.versao ?? 0) + 1,
          parametros: parametros as Prisma.InputJsonValue,
          ativa: entrada.ativa ?? true,
          vigenciaInicio: inicio,
          vigenciaFim: entrada.vigenciaFim ?? null,
          autorId: ator.id ?? 'SISTEMA',
          motivo: entrada.motivo,
        },
      });
      // a configuração precisa continuar resolvível depois da mudança
      try {
        resolverConfiguracao(
          (await tx.regraVersao.findMany({ include: { regra: true } })).map(paraEntrada),
          inicio,
        );
      } catch (e) {
        throw new ErroNegocio(
          'CONFIGURACAO_INVALIDA',
          `a alteração deixaria a configuração inválida: ${(e as Error).message}`,
          400,
        );
      }
      await this.auditoria.registrar(
        ator,
        'REGRA_NOVA_VERSAO',
        'Regra',
        regra.id,
        {
          antes: anterior
            ? { versao: anterior.versao, parametros: anterior.parametros, ativa: anterior.ativa }
            : null,
          depois: {
            versao: versao.versao,
            parametros,
            ativa: versao.ativa,
            vigenciaInicio: inicio,
          },
          motivo: entrada.motivo,
        },
        tx,
      );
      return { regra, versao };
    };
    const r = txExterna ? await executar(txExterna) : await this.prisma.transacao(executar);
    this.cache = null;
    return r;
  }

  async criarCampanha(
    entrada: {
      nome: string;
      descricao?: string | null;
      parametros: unknown;
      inicio: Date;
      fim: Date;
      perfil?: PerfilComercial | null;
      motivo: string;
    },
    ator: Ator,
  ) {
    return this.prisma.transacao(async (tx) => {
      const campanha = await tx.campanha.create({
        data: { nome: entrada.nome, descricao: entrada.descricao ?? null },
      });
      const r = await this.criarVersao(
        {
          escopo: 'CAMPANHA',
          filtros: { campanhaId: campanha.id, perfil: entrada.perfil ?? null },
          nome: entrada.nome,
          parametros: entrada.parametros,
          vigenciaInicio: entrada.inicio,
          vigenciaFim: entrada.fim,
          motivo: entrada.motivo,
        },
        ator,
        tx,
      );
      return { campanha, ...r };
    });
  }

  /** Simulador: "quanto esta venda geraria?" com a configuração vigente no instante. */
  async simular(venda: VendaCalculo) {
    const config = await this.configuracaoEm(venda.instante);
    const resultado = calcularVenda(venda, config);
    return { resultado, alertasMargem: avaliarPisosMargem(resultado, config) };
  }

  async regrasEmLinguagemSimples() {
    return gerarRegrasEmLinguagemSimples(await this.configuracaoAtual());
  }

  invalidarCache() {
    this.cache = null;
  }
}
