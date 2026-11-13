'use client';

export class ErroApi extends Error {
  constructor(
    public readonly status: number,
    public readonly codigo: string,
    mensagem: string,
    public readonly dados?: Record<string, unknown>,
  ) {
    super(mensagem);
  }
}

/**
 * Cliente da API (mesma origem: /api → serviço api). Sessão em cookie httpOnly;
 * o header X-CDC-Requisicao protege as escritas contra CSRF.
 */
export async function api<T = unknown>(
  caminho: string,
  opcoes: { method?: string; body?: unknown; form?: FormData; idempotencia?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'X-CDC-Requisicao': '1' };
  if (opcoes.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opcoes.idempotencia) headers['Idempotency-Key'] = opcoes.idempotencia;
  const r = await fetch(`/api${caminho}`, {
    method: opcoes.method ?? (opcoes.body !== undefined || opcoes.form ? 'POST' : 'GET'),
    headers,
    credentials: 'same-origin',
    body: opcoes.form ?? (opcoes.body !== undefined ? JSON.stringify(opcoes.body) : undefined),
    cache: 'no-store',
  });
  const texto = await r.text();
  const corpo = texto ? JSON.parse(texto) : null;
  if (!r.ok) {
    throw new ErroApi(
      r.status,
      corpo?.erro ?? 'ERRO',
      corpo?.mensagem ?? `erro ${r.status}`,
      corpo?.dados,
    );
  }
  return corpo as T;
}

export function novaChave() {
  return globalThis.crypto.randomUUID();
}
