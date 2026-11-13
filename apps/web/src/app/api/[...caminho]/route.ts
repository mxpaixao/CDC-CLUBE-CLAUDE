import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

const REMOVER = [
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'keep-alive',
  'upgrade',
];

/**
 * Proxy same-origin /api/* → API (lido em tempo de execução de API_URL).
 * Em produção o nginx já encaminha /api direto para o serviço "api"; este proxy cobre
 * desenvolvimento e acesso direto ao container web.
 */
async function proxy(req: NextRequest, ctx: { params: Promise<{ caminho: string[] }> }) {
  const { caminho } = await ctx.params;
  const base = process.env.API_URL ?? 'http://localhost:3001';
  const destino = `${base}/${caminho.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;
  const headers = new Headers(req.headers);
  for (const h of REMOVER) headers.delete(h);
  headers.set('x-forwarded-for', req.headers.get('x-forwarded-for') ?? '127.0.0.1');
  const resposta = await fetch(destino, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer(),
    redirect: 'manual',
    cache: 'no-store',
  });
  const saida = new Headers(resposta.headers);
  for (const h of ['content-encoding', 'content-length', 'transfer-encoding', 'connection'])
    saida.delete(h);
  return new Response(resposta.body, { status: resposta.status, headers: saida });
}

export { proxy as DELETE, proxy as GET, proxy as PATCH, proxy as POST, proxy as PUT };
