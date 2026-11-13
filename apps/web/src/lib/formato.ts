import { formatarBRL } from '@cdc/shared/dist/dinheiro';

export const brl = (centavos: number | null | undefined) => formatarBRL(Number(centavos ?? 0));

export const pct = (bps: number | null | undefined) =>
  bps === null || bps === undefined
    ? '—'
    : `${(bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

const FUSO = 'America/Manaus';
export const data = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: FUSO }) : '—';
export const dataHora = (d: string | Date | null | undefined) =>
  d
    ? new Date(d).toLocaleString('pt-BR', {
        timeZone: FUSO,
        dateStyle: 'short',
        timeStyle: 'short',
      })
    : '—';

export function diasAte(d: string | Date) {
  const ms = new Date(d).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

/** "12,34" → 1234 centavos (sem float). */
export function reaisParaCentavos(texto: string): number {
  const t = (texto ?? '')
    .trim()
    .replace(/\s|R\$/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return NaN;
  const [i, f = ''] = t.split('.');
  return Number(i) * 100 + Number((f + '00').slice(0, 2));
}

export const ORIGENS: Record<string, string> = {
  COMPRA: 'Compra',
  BOAS_VINDAS: 'Boas-vindas',
  INDICACAO: 'Indicação',
  CAMPANHA: 'Campanha',
  AJUSTE_MANUAL: 'Ajuste manual',
  ESTORNO: 'Estorno (devolução)',
  VENCIMENTO: 'Vencimento',
  RESGATE: 'Usado no caixa',
  QUITACAO_SALDO_DEVEDOR: 'Quitação de saldo devedor',
  DEVOLUCAO_CASHBACK_UTILIZADO: 'Crédito devolvido (devolução)',
};

export const ESTADOS: Record<string, { rotulo: string; classe: string }> = {
  PENDENTE: { rotulo: 'Pendente', classe: 'alerta' },
  DISPONIVEL: { rotulo: 'Disponível', classe: 'ok' },
  RESGATADO: { rotulo: 'Usado', classe: '' },
  VENCIDO: { rotulo: 'Vencido', classe: 'erro' },
  ESTORNADO: { rotulo: 'Estornado', classe: 'erro' },
  EFETIVADO: { rotulo: 'Efetivado', classe: '' },
};

export function mascararDoc(doc: string) {
  const d = (doc ?? '').replace(/\W/g, '');
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14)
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return doc;
}

/** "5" → 500 bps; "2,5" → 250 bps (sem float). */
export function percentualParaBps(texto: string): number {
  const t = (texto ?? '').trim().replace('%', '').replace(',', '.');
  if (!/^\d{1,3}(\.\d{0,2})?$/.test(t)) return NaN;
  const [i, f = ''] = t.split('.');
  const bps = Number(i) * 100 + Number((f + '00').slice(0, 2));
  return bps <= 10_000 ? bps : NaN;
}
