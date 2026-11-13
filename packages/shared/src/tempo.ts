import { DateTime } from 'luxon';

/**
 * Todas as regras de data do Clube (carência, vencimento, tetos mensais, horário comercial)
 * usam o fuso America/Manaus (docs/DECISOES.md · D-004).
 */
export const FUSO_CDC = 'America/Manaus';

/** Data civil local no formato ISO (YYYY-MM-DD). */
export type DataLocal = string;

function dt(instante: Date): DateTime {
  return DateTime.fromJSDate(instante, { zone: FUSO_CDC });
}

function deDataLocal(data: DataLocal): DateTime {
  const d = DateTime.fromISO(data, { zone: FUSO_CDC });
  if (!d.isValid) throw new Error(`data local inválida: ${data}`);
  return d;
}

export function dataLocal(instante: Date): DataLocal {
  return dt(instante).toISODate() as DataLocal;
}

export function somarDiasDataLocal(data: DataLocal, dias: number): DataLocal {
  return deDataLocal(data).plus({ days: dias }).toISODate() as DataLocal;
}

/** 00:00:00.000 do dia local. */
export function inicioDoDiaLocal(data: DataLocal): Date {
  return deDataLocal(data).startOf('day').toJSDate();
}

/** 23:59:59.999 do dia local. */
export function fimDoDiaLocal(data: DataLocal): Date {
  return deDataLocal(data).endOf('day').toJSDate();
}

/**
 * Crédito liberado no INÍCIO do dia local (confirmação + carência).
 * Ex.: venda confirmada 10/03 23:30 Manaus, carência 7 → libera 17/03 00:00 Manaus.
 */
export function calcularLiberaEm(confirmacao: Date, carenciaDias: number): Date {
  return inicioDoDiaLocal(somarDiasDataLocal(dataLocal(confirmacao), carenciaDias));
}

/**
 * Crédito vence no FIM do dia local (data da liberação + validade).
 * Ex.: liberado 17/03, validade 30 → vence 16/04 23:59:59.999 Manaus.
 */
export function calcularVenceEm(liberacao: Date, validadeDias: number): Date {
  return fimDoDiaLocal(somarDiasDataLocal(dataLocal(liberacao), validadeDias));
}

/** Mês civil local "YYYY-MM". */
export function mesCivilLocal(instante: Date): string {
  return dt(instante).toFormat('yyyy-LL');
}

/** Intervalo [início, fim) do mês civil local que contém o instante. */
export function intervaloMesCivil(instante: Date): { inicio: Date; fim: Date } {
  const d = dt(instante).startOf('month');
  return { inicio: d.toJSDate(), fim: d.plus({ months: 1 }).toJSDate() };
}

/** Dias civis locais entre dois instantes (b − a). */
export function diasCivisEntre(a: Date, b: Date): number {
  const da = dt(a).startOf('day');
  const db = dt(b).startOf('day');
  return Math.round(db.diff(da, 'days').days);
}

export function somarMinutos(instante: Date, minutos: number): Date {
  return new Date(instante.getTime() + minutos * 60_000);
}

export function somarDias(instante: Date, dias: number): Date {
  return dt(instante).plus({ days: dias }).toJSDate();
}

/**
 * Está dentro do horário comercial local? `inicio`/`fim` em "HH:mm"; `diasSemana` 1=segunda … 7=domingo.
 */
export function dentroDoHorarioComercial(
  instante: Date,
  janela: { inicio: string; fim: string; diasSemana: number[] },
): boolean {
  const d = dt(instante);
  if (!janela.diasSemana.includes(d.weekday)) return false;
  const hhmm = d.toFormat('HH:mm');
  return hhmm >= janela.inicio && hhmm < janela.fim;
}

/** Próximo instante dentro do horário comercial (ou o próprio instante se já estiver). */
export function proximoHorarioComercial(
  instante: Date,
  janela: { inicio: string; fim: string; diasSemana: number[] },
): Date {
  if (dentroDoHorarioComercial(instante, janela)) return instante;
  const [h, m] = janela.inicio.split(':').map(Number);
  let d = dt(instante);
  for (let i = 0; i < 8; i++) {
    const candidato = d.startOf('day').set({ hour: h, minute: m });
    if (
      janela.diasSemana.includes(candidato.weekday) &&
      candidato.toMillis() > dt(instante).toMillis()
    ) {
      return candidato.toJSDate();
    }
    d = d.plus({ days: 1 });
  }
  return instante;
}

export function formatarDataLocal(instante: Date, formato = 'dd/LL/yyyy'): string {
  return dt(instante).toFormat(formato);
}

export function formatarDataHoraLocal(instante: Date): string {
  return dt(instante).toFormat('dd/LL/yyyy HH:mm');
}
