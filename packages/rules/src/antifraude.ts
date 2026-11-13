import {
  type Centavos,
  type NivelPrestador,
  type ParametrosNivelPrestador,
  type ParametrosPrograma,
  normalizarCnpj,
  normalizarCpf,
  normalizarTelefone,
} from '@cdc/shared';

export interface PartesIndicacao {
  comprador: {
    /** CPF do comprador PF ou de todas as pessoas vinculadas à empresa compradora. */
    cpfs: string[];
    cnpj?: string | null;
    telefones: string[];
  };
  prestador: {
    cpfTitular: string;
    cnpj?: string | null;
    telefones: string[];
  };
}

export type MotivoAutoindicacao = 'MESMO_CPF' | 'MESMO_CNPJ' | 'MESMO_TELEFONE';

/** Bloqueia autoindicação: comprador = titular do prestador, ou mesmo CNPJ, ou mesmo telefone. */
export function verificarAutoindicacao(p: PartesIndicacao): {
  bloqueada: boolean;
  motivos: MotivoAutoindicacao[];
} {
  const motivos: MotivoAutoindicacao[] = [];
  const cpfTitular = normalizarCpf(p.prestador.cpfTitular);
  if (p.comprador.cpfs.some((c) => normalizarCpf(c) === cpfTitular)) motivos.push('MESMO_CPF');
  if (
    p.comprador.cnpj &&
    p.prestador.cnpj &&
    normalizarCnpj(p.comprador.cnpj) === normalizarCnpj(p.prestador.cnpj)
  ) {
    motivos.push('MESMO_CNPJ');
  }
  const telsPrestador = new Set(p.prestador.telefones.map(normalizarTelefone).filter(Boolean));
  if (p.comprador.telefones.map(normalizarTelefone).some((t) => t && telsPrestador.has(t)))
    motivos.push('MESMO_TELEFONE');
  return { bloqueada: motivos.length > 0, motivos };
}

export interface VendaIndicadaResumo {
  vendaId: string;
  compradorChave: string;
  valorCentavos: Centavos;
  instante: Date;
  cancelada: boolean;
}

export type TipoPadraoSuspeito = 'COMPRADOR_REPETIDO' | 'VALORES_REDONDOS' | 'MUITAS_CANCELADAS';

export interface PadraoSuspeito {
  tipo: TipoPadraoSuspeito;
  descricao: string;
  vendaIds: string[];
  dados: Record<string, unknown>;
}

/** Padrões suspeitos nas vendas indicadas de UM prestador, dentro da janela configurada. */
export function detectarPadroesSuspeitos(
  vendas: readonly VendaIndicadaResumo[],
  parametros: ParametrosPrograma['antifraude'],
  agora: Date,
): PadraoSuspeito[] {
  const limite = agora.getTime() - parametros.janelaDias * 86_400_000;
  const janela = vendas.filter(
    (v) => v.instante.getTime() >= limite && v.instante.getTime() <= agora.getTime(),
  );
  const alertas: PadraoSuspeito[] = [];

  const porComprador = new Map<string, VendaIndicadaResumo[]>();
  for (const v of janela)
    porComprador.set(v.compradorChave, [...(porComprador.get(v.compradorChave) ?? []), v]);
  for (const [comprador, lista] of porComprador) {
    if (lista.length > parametros.maxVendasMesmoCompradorNaJanela) {
      alertas.push({
        tipo: 'COMPRADOR_REPETIDO',
        descricao: `mesmo comprador em ${lista.length} vendas indicadas em ${parametros.janelaDias} dias`,
        vendaIds: lista.map((v) => v.vendaId),
        dados: { compradorChave: comprador, quantidade: lista.length },
      });
    }
  }

  const redondas = janela.filter(
    (v) => v.valorCentavos > 0 && v.valorCentavos % parametros.valorRedondoMultiploCentavos === 0,
  );
  if (redondas.length > parametros.maxValoresRedondosNaJanela) {
    alertas.push({
      tipo: 'VALORES_REDONDOS',
      descricao: `${redondas.length} vendas indicadas com valores redondos em ${parametros.janelaDias} dias`,
      vendaIds: redondas.map((v) => v.vendaId),
      dados: { quantidade: redondas.length },
    });
  }

  if (janela.length >= parametros.minimoVendasParaAvaliarCancelamento) {
    const canceladas = janela.filter((v) => v.cancelada);
    const percentualBps = Math.floor((canceladas.length * 10_000) / janela.length);
    if (percentualBps > parametros.maxPercentualCanceladasBps) {
      alertas.push({
        tipo: 'MUITAS_CANCELADAS',
        descricao: `${canceladas.length} de ${janela.length} vendas indicadas canceladas/devolvidas`,
        vendaIds: canceladas.map((v) => v.vendaId),
        dados: { canceladas: canceladas.length, total: janela.length, percentualBps },
      });
    }
  }
  return alertas;
}

/** Nível do prestador pelos critérios configurados (o maior nível cujos critérios forem atendidos). */
export function calcularNivel(
  parametros: ParametrosNivelPrestador,
  desempenho: { volumeIndicadoCentavos: Centavos; vendasIndicadas: number },
): NivelPrestador {
  const ordem: NivelPrestador[] = ['OURO', 'PRATA', 'BRONZE'];
  for (const nivel of ordem) {
    const c = parametros.criterios.find((x) => x.nivel === nivel);
    if (!c) continue;
    if (
      desempenho.volumeIndicadoCentavos >= c.volumeIndicadoMinimoCentavos &&
      desempenho.vendasIndicadas >= c.vendasIndicadasMinimas
    ) {
      return nivel;
    }
  }
  return 'BRONZE';
}
