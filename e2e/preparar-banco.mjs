// Executado pelo webServer da API antes de subir: banco E2E migrado, limpo e com seed fictício.
// Trava de segurança: só roda em bancos cujo nome termina com _e2e ou _test.
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';

const url = new URL(process.env.DATABASE_URL);
const banco = url.pathname.replace(/^\//, '');
if (!/_(e2e|test)$/.test(banco)) {
  throw new Error(`preparar-banco recusado: "${banco}" não é um banco de teste (*_e2e / *_test)`);
}
const opcoes = { cwd: '../apps/api', env: process.env, stdio: 'inherit' };
execSync('npx prisma migrate deploy', opcoes);

const { PrismaClient } = createRequire(new URL('../apps/api/package.json', import.meta.url))(
  '@prisma/client',
);
const prisma = new PrismaClient();
const tabelas =
  await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
await prisma.$transaction([
  prisma.$executeRawUnsafe(`SET LOCAL cdc.permitir_limpeza = 'on'`),
  prisma.$executeRawUnsafe(
    `TRUNCATE ${tabelas.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
  ),
]);
await prisma.$disconnect();

execSync('node dist/prisma/seed.js', opcoes);
rmSync('/tmp/clube-cdc-e2e-mensagens.jsonl', { force: true });
