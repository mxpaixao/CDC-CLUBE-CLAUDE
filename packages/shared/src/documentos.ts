/** Validação e normalização de CPF, CNPJ (numérico e alfanumérico — IN RFB 2.229/2024) e telefone. */

export function somenteDigitos(valor: string): string {
  return (valor ?? '').replace(/\D/g, '');
}

export function normalizarCpf(cpf: string): string {
  return somenteDigitos(cpf).padStart(11, '0').slice(-11);
}

export function cpfValido(cpf: string): boolean {
  const d = somenteDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (len: number) => {
    let soma = 0;
    for (let i = 0; i < len; i++) soma += Number(d[i]) * (len + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

export function formatarCpf(cpf: string): string {
  const d = normalizarCpf(cpf);
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** CPF mascarado para exibição a terceiros (ex.: prestador vendo suas indicações). */
export function mascararCpf(cpf: string): string {
  const d = normalizarCpf(cpf);
  return `***.${d.slice(3, 6)}.***-**`;
}

/** Remove pontuação e coloca em caixa alta. Aceita CNPJ numérico e alfanumérico. */
export function normalizarCnpj(cnpj: string): string {
  return (cnpj ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function valorCaractereCnpj(c: string): number {
  return c.charCodeAt(0) - 48; // '0'..'9' → 0..9 ; 'A'..'Z' → 17..42
}

export function cnpjValido(cnpj: string): boolean {
  const c = normalizarCnpj(cnpj);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(c)) return false;
  if (/^(\d)\1{13}$/.test(c)) return false;
  const dv = (base: string) => {
    const pesos =
      base.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = base.split('').reduce((acc, ch, i) => acc + valorCaractereCnpj(ch) * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const d1 = dv(c.slice(0, 12));
  const d2 = dv(c.slice(0, 12) + d1);
  return d1 === Number(c[12]) && d2 === Number(c[13]);
}

export function formatarCnpj(cnpj: string): string {
  const c = normalizarCnpj(cnpj);
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

export type TipoDocumento = 'CPF' | 'CNPJ';

/** Identifica se o documento informado é CPF ou CNPJ válido. */
export function identificarDocumento(doc: string): { tipo: TipoDocumento; valor: string } | null {
  const digitos = somenteDigitos(doc);
  if (digitos.length === 11 && cpfValido(digitos)) return { tipo: 'CPF', valor: digitos };
  const cnpj = normalizarCnpj(doc);
  if (cnpj.length === 14 && cnpjValido(cnpj)) return { tipo: 'CNPJ', valor: cnpj };
  return null;
}

/** Normaliza telefone brasileiro para E.164 (+55DDDNUMERO). Retorna null se inválido. */
export function normalizarTelefone(telefone: string): string | null {
  let d = somenteDigitos(telefone);
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length !== 10 && d.length !== 11) return null;
  if (Number(d.slice(0, 2)) < 11) return null;
  if (d.length === 11 && d[2] !== '9') return null;
  return `+55${d}`;
}

export function mascararTelefone(e164: string): string {
  const d = somenteDigitos(e164);
  return `(${d.slice(2, 4)}) *****-${d.slice(-4)}`;
}

/** Primeiro nome, para exibição minimizada (LGPD). */
export function primeiroNome(nome: string): string {
  return (nome ?? '').trim().split(/\s+/)[0] ?? '';
}

/** Gera CPF válido (uso exclusivo em seeds/testes). */
export function gerarCpfValido(base9: string): string {
  const d = somenteDigitos(base9).padStart(9, '0').slice(0, 9);
  const calc = (s: string) => {
    let soma = 0;
    for (let i = 0; i < s.length; i++) soma += Number(s[i]) * (s.length + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  const d1 = calc(d);
  const d2 = calc(d + d1);
  return `${d}${d1}${d2}`;
}

/** Gera CNPJ válido (uso exclusivo em seeds/testes). */
export function gerarCnpjValido(base12: string): string {
  const b = normalizarCnpj(base12).padStart(12, '0').slice(0, 12);
  const dv = (base: string) => {
    const pesos =
      base.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = base.split('').reduce((acc, ch, i) => acc + valorCaractereCnpj(ch) * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const d1 = dv(b);
  const d2 = dv(b + d1);
  return `${b}${d1}${d2}`;
}
