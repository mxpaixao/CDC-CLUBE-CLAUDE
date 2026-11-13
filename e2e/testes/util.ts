import { existsSync, readFileSync } from 'node:fs';

const ARQUIVO = '/tmp/clube-cdc-e2e-mensagens.jsonl';

/**
 * Aguarda o código de 6 dígitos enviado ao telefone depois de `desde`
 * (provedor console espelhado em arquivo pela API de E2E).
 */
export async function aguardarCodigo(telefoneE164: string, desde: number): Promise<string> {
  for (let i = 0; i < 100; i++) {
    if (existsSync(ARQUIVO)) {
      const msgs = readFileSync(ARQUIVO, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { destino: string; texto: string; em: string });
      const msg = msgs
        .reverse()
        .find((m) => m.destino === telefoneE164 && new Date(m.em).getTime() >= desde - 1000);
      const codigo = /(\d{6})/.exec(msg?.texto ?? '')?.[1];
      if (codigo) return codigo;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`nenhum código enviado para ${telefoneE164}`);
}

export const ADMIN = { email: 'admin@cdc.local', senha: 'senha-admin-e2e-123' };
export const CAIXA = { email: 'caixa@cdc.local', senha: 'Exemplo@CDC2026' };
