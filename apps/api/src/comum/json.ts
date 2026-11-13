/** Converte Decimal/BigInt/Date para JSON seguro (respostas da API e auditoria). */
export function paraJson<T>(valor: T): unknown {
  return JSON.parse(
    JSON.stringify(valor, (_k, v) => {
      if (typeof v === 'bigint') return Number(v);
      if (
        v &&
        typeof v === 'object' &&
        typeof (v as { toFixed?: unknown }).toFixed === 'function' &&
        'd' in v
      ) {
        return (v as { toString(): string }).toString();
      }
      return v;
    }),
  );
}
