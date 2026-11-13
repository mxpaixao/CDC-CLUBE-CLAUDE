/** Inteiro aleatório uniforme em [0, max) via Web Crypto (Node 22+ e navegadores). */
export function randomInt(max: number): number {
  const limite = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0] < limite) return buf[0] % max;
  }
}

/**
 * Códigos legíveis, sem ambiguidades visuais.
 * - Dígitos usam apenas 2–9 (nunca 0/1), então "O" e "I" nos códigos são sempre letras.
 * - Na leitura, 0→O e 1→I são corrigidos automaticamente.
 */
export const ALFABETO_SEM_AMBIGUIDADE = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const DIGITOS_SEGUROS = '23456789';

function semAcentos(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function aleatorio(alfabeto: string, tamanho: number, rnd: (max: number) => number): string {
  let s = '';
  for (let i = 0; i < tamanho; i++) s += alfabeto[rnd(alfabeto.length)];
  return s;
}

/**
 * Código de indicação do prestador, ex.: "CDC-JOAO27".
 * @param tentativa usada para ampliar o sufixo em caso de colisão.
 */
export function gerarCodigoPrestador(
  nome: string,
  tentativa = 0,
  rnd: (max: number) => number = randomInt,
): string {
  const primeiro =
    semAcentos(nome)
      .toUpperCase()
      .replace(/[^A-Z\s]/g, '')
      .trim()
      .split(/\s+/)[0] || 'PRO';
  const raiz = primeiro.slice(0, 6);
  const tamanhoSufixo = tentativa < 5 ? 2 : tentativa < 15 ? 3 : 4;
  return `CDC-${raiz}${aleatorio(DIGITOS_SEGUROS, tamanhoSufixo, rnd)}`;
}

/** Normaliza o que foi digitado/lido no caixa: "cdc joao27", "CDC-J0A027" → "CDC-JOAO27". */
export function normalizarCodigoPrestador(entrada: string): string {
  let s = semAcentos(entrada ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
  if (s.startsWith('CDC')) s = s.slice(3);
  // separa raiz (letras) de sufixo (dígitos 2-9); 0/1 na raiz viram O/I
  const match = /^([A-Z01]+?)([2-9]+)$/.exec(s);
  if (!match) return `CDC-${s.replace(/0/g, 'O').replace(/1/g, 'I')}`;
  const raiz = match[1].replace(/0/g, 'O').replace(/1/g, 'I');
  return `CDC-${raiz}${match[2]}`;
}

/** Código de resgate a ser lançado no ERP, ex.: "R7K4M9P2". */
export function gerarCodigoResgate(rnd: (max: number) => number = randomInt): string {
  return `R${aleatorio(ALFABETO_SEM_AMBIGUIDADE, 7, rnd)}`;
}

export function normalizarCodigoResgate(entrada: string): string {
  return (entrada ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/0/g, 'O')
    .replace(/1/g, 'I');
}

/** OTP numérico de 6 dígitos. */
export function gerarOtp(rnd: (max: number) => number = randomInt): string {
  return aleatorio('0123456789', 6, rnd);
}
