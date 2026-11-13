import type { EscopoRegra, PerfilComercial } from '@cdc/shared';
import type { VersaoRegraEntrada } from '../configuracao';
import { resolverConfiguracao } from '../configuracao';
import type { ItemCalculo, VendaCalculo } from '../calculo';
import { MATRIZ_V1, NIVEL_PRESTADOR_V1, PERFIS_V1, PROGRAMA_V1 } from '../seed-v1';

export const IMPLANTACAO = new Date('2026-01-01T04:00:00Z'); // 01/01/2026 00:00 Manaus
export const AGORA = new Date('2026-03-10T15:00:00Z'); // 10/03/2026 11:00 Manaus

let seq = 0;
export function versao(
  escopo: EscopoRegra,
  parametros: unknown,
  extra: Partial<VersaoRegraEntrada> = {},
): VersaoRegraEntrada {
  seq += 1;
  return {
    regraVersaoId: extra.regraVersaoId ?? `rv-${escopo}-${seq}`,
    regraId: extra.regraId ?? `r-${escopo}-${seq}`,
    escopo,
    versao: 1,
    vigenciaInicio: IMPLANTACAO,
    parametros,
    ...extra,
  };
}

export function versoesV1(): VersaoRegraEntrada[] {
  return [
    versao('PROGRAMA', PROGRAMA_V1, { regraId: 'r-programa', regraVersaoId: 'rv-programa-1' }),
    ...(Object.keys(PERFIS_V1) as PerfilComercial[]).map((p) =>
      versao('PERFIL', PERFIS_V1[p], {
        perfil: p,
        regraId: `r-perfil-${p}`,
        regraVersaoId: `rv-perfil-${p}-1`,
      }),
    ),
    versao('MATRIZ', MATRIZ_V1, { regraId: 'r-matriz', regraVersaoId: 'rv-matriz-1' }),
    versao('NIVEL_PRESTADOR', NIVEL_PRESTADOR_V1, {
      regraId: 'r-nivel',
      regraVersaoId: 'rv-nivel-1',
    }),
  ];
}

export function configV1(extras: VersaoRegraEntrada[] = [], instante = AGORA) {
  return resolverConfiguracao([...versoesV1(), ...extras], instante);
}

export function item(
  id: string,
  valorCentavos: number,
  extra: Partial<ItemCalculo> = {},
): ItemCalculo {
  return {
    id,
    sku: `SKU-${id}`,
    familia: 'GERAL',
    subfamilia: 'GERAL-01',
    tipo: 'MERCADORIA',
    valorBrutoCentavos: valorCentavos,
    descontoCentavos: 0,
    ...extra,
  };
}

export function venda(itens: ItemCalculo[], extra: Partial<VendaCalculo> = {}): VendaCalculo {
  return {
    lojaId: 'LOJA-01',
    canal: 'LOJA',
    instante: AGORA,
    perfil: 'CLIENTE_CPF',
    itens,
    pagoComCashbackCentavos: 0,
    compradorParticipante: true,
    boasVindas: false,
    indicacao: null,
    ...extra,
  };
}
