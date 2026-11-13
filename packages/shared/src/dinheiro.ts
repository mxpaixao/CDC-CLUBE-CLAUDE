/**
 * Dinheiro no Clube CDC é SEMPRE inteiro em centavos. Nunca float.
 * Percentuais são expressos em pontos-base (bps): 1% = 100 bps, 100% = 10.000 bps.
 *
 * Regra de arredondamento (docs/DECISOES.md · D-003): crédito ao cliente/prestador é
 * calculado com precisão total (centavos × bps) e arredondado UMA vez, PARA BAIXO (floor).
 */
export type Centavos = number;
export type Bps = number;

export const BPS_100_PORCENTO = 10_000;

export class ErroDinheiro extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroDinheiro';
  }
}

export function ehCentavos(valor: unknown): valor is Centavos {
  return typeof valor === 'number' && Number.isSafeInteger(valor);
}

export function exigirCentavos(valor: unknown, campo = 'valor'): Centavos {
  if (!ehCentavos(valor)) {
    throw new ErroDinheiro(`${campo} deve ser inteiro em centavos (recebido: ${String(valor)})`);
  }
  return valor;
}

export function exigirBps(valor: unknown, campo = 'percentual'): Bps {
  if (!ehCentavos(valor) || valor < 0 || valor > BPS_100_PORCENTO) {
    throw new ErroDinheiro(
      `${campo} deve ser inteiro em bps entre 0 e 10000 (recebido: ${String(valor)})`,
    );
  }
  return valor;
}

/**
 * Acumulador exato de "centavos × bps" (unidade = 1/10000 de centavo).
 * Usa BigInt para nunca perder precisão em somatórios grandes.
 */
export class AcumuladorBps {
  private total = 0n;

  adicionar(baseCentavos: Centavos, bps: Bps): this {
    exigirCentavos(baseCentavos, 'base');
    exigirBps(bps);
    if (baseCentavos < 0) throw new ErroDinheiro('base negativa não gera crédito');
    this.total += BigInt(baseCentavos) * BigInt(bps);
    return this;
  }

  /** Resultado em centavos, arredondado PARA BAIXO. */
  resultadoFloor(): Centavos {
    return Number(this.total / BigInt(BPS_100_PORCENTO));
  }

  /** Valor bruto em 1/10000 de centavo (útil para auditoria do cálculo). */
  bruto(): bigint {
    return this.total;
  }
}

/** floor(valor × bps / 10000) com precisão total. */
export function aplicarBpsFloor(valorCentavos: Centavos, bps: Bps): Centavos {
  return new AcumuladorBps().adicionar(valorCentavos, bps).resultadoFloor();
}

/** floor(valor × numerador / denominador) com precisão total, para rateios proporcionais. */
export function proporcaoFloor(
  valorCentavos: Centavos,
  numerador: number,
  denominador: number,
): Centavos {
  exigirCentavos(valorCentavos);
  exigirCentavos(numerador, 'numerador');
  exigirCentavos(denominador, 'denominador');
  if (denominador <= 0) throw new ErroDinheiro('denominador deve ser positivo');
  if (valorCentavos < 0 || numerador < 0)
    throw new ErroDinheiro('valores negativos não suportados');
  return Number((BigInt(valorCentavos) * BigInt(numerador)) / BigInt(denominador));
}

export function somarCentavos(valores: readonly Centavos[]): Centavos {
  let total = 0n;
  for (const v of valores) total += BigInt(exigirCentavos(v));
  const resultado = Number(total);
  if (!Number.isSafeInteger(resultado)) throw new ErroDinheiro('soma excede o limite seguro');
  return resultado;
}

/**
 * Rateia `total` entre `pesos` proporcionalmente, pelo método dos maiores restos (Hamilton).
 * A soma do resultado é exatamente `total`. Empates são resolvidos pelo menor índice.
 */
export function ratearProporcional(total: Centavos, pesos: readonly Centavos[]): Centavos[] {
  exigirCentavos(total, 'total');
  if (total < 0) throw new ErroDinheiro('total do rateio não pode ser negativo');
  const somaPesos = somarCentavos(pesos);
  if (pesos.some((p) => p < 0)) throw new ErroDinheiro('pesos negativos não suportados');
  if (somaPesos === 0) {
    if (total === 0) return pesos.map(() => 0);
    throw new ErroDinheiro('não é possível ratear valor positivo entre pesos zerados');
  }
  const T = BigInt(total);
  const S = BigInt(somaPesos);
  const partes = pesos.map((p, indice) => {
    const produto = T * BigInt(p);
    return { indice, base: produto / S, resto: produto % S };
  });
  let distribuido = partes.reduce((acc, p) => acc + p.base, 0n);
  const ordem = [...partes].sort((a, b) =>
    a.resto === b.resto ? a.indice - b.indice : a.resto > b.resto ? -1 : 1,
  );
  const extras = new Set<number>();
  for (const parte of ordem) {
    if (distribuido >= T) break;
    extras.add(parte.indice);
    distribuido += 1n;
  }
  return partes.map((p) => Number(p.base) + (extras.has(p.indice) ? 1 : 0));
}

export type SeparadorDecimal = 'virgula' | 'ponto';

/**
 * Converte texto monetário ("R$ 1.234,56", "1234.56", "-10,5") em centavos sem usar float.
 * Valores com mais de 2 casas decimais não nulas são rejeitados.
 */
export function parseValorMonetario(
  texto: string | number,
  separador: SeparadorDecimal = 'virgula',
): Centavos {
  if (typeof texto === 'number') {
    if (!Number.isFinite(texto)) throw new ErroDinheiro(`valor inválido: ${texto}`);
    // números vindos de planilha: converte via representação decimal exata de 2 casas
    texto = texto.toFixed(6);
    separador = 'ponto';
  }
  let s = String(texto)
    .trim()
    .replace(/^R\$\s*/i, '')
    .replace(/\s/g, '');
  if (s === '') throw new ErroDinheiro('valor vazio');
  let negativo = false;
  if (s.startsWith('-')) {
    negativo = true;
    s = s.slice(1);
  } else if (s.startsWith('(') && s.endsWith(')')) {
    negativo = true;
    s = s.slice(1, -1);
  }
  if (separador === 'virgula') s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) throw new ErroDinheiro(`valor monetário inválido: "${texto}"`);
  const [inteiro, fracao = ''] = s.split('.');
  const extra = fracao.slice(2);
  if (extra && /[1-9]/.test(extra)) {
    throw new ErroDinheiro(`valor com mais de 2 casas decimais: "${texto}"`);
  }
  const centavos = Number(BigInt(inteiro) * 100n + BigInt((fracao + '00').slice(0, 2)));
  if (!Number.isSafeInteger(centavos)) throw new ErroDinheiro('valor excede o limite seguro');
  return negativo ? -centavos : centavos;
}

export function formatarBRL(centavos: Centavos): string {
  exigirCentavos(centavos);
  const negativo = centavos < 0;
  const abs = Math.abs(centavos);
  const reais = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const cent = (abs % 100).toString().padStart(2, '0');
  return `${negativo ? '-' : ''}R$ ${reais},${cent}`;
}

/** "3%" a partir de bps (300 → "3%", 250 → "2,5%"). */
export function formatarBps(bps: Bps): string {
  const inteiro = Math.floor(bps / 100);
  const resto = bps % 100;
  if (resto === 0) return `${inteiro}%`;
  return `${inteiro},${resto.toString().padStart(2, '0').replace(/0$/, '')}%`;
}
