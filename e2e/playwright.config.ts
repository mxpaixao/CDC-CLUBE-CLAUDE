import { defineConfig, devices } from '@playwright/test';

/**
 * E2E dos fluxos principais (painel, caixa e app). Sobe API + web contra o banco clube_cdc_e2e.
 * Pré-requisito: `pnpm build` (API compilada e Next buildado), Postgres e Redis no ar.
 */
const DB =
  process.env.DATABASE_URL_E2E ?? 'postgresql://cdc:cdc@localhost:5432/clube_cdc_e2e?schema=public';
export const ARQUIVO_MENSAGENS = '/tmp/clube-cdc-e2e-mensagens.jsonl';

export default defineConfig({
  testDir: './testes',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'off',
    locale: 'pt-BR',
    timezoneId: 'America/Manaus',
  },
  projects: [
    { name: 'painel', testMatch: /painel\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'app', testMatch: /app\.spec\.ts/, use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      // prepara o banco E2E (reset + migrations + seed fictício) e sobe a API compilada
      command: 'node ./preparar-banco.mjs && node ../apps/api/dist/src/main.js',
      url: 'http://localhost:3101/saude',
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        PORT: '3101',
        DATABASE_URL: DB,
        SEED_EXEMPLOS: 'true',
        SEED_SENHA_ADMIN: 'senha-admin-e2e-123',
        NODE_ENV: 'development',
        JWT_SECRET: 'segredo-e2e-com-mais-de-32-caracteres-000000',
        NOTIFICADOR_ARQUIVO: ARQUIVO_MENSAGENS,
        LOG_LEVEL: 'warn',
      },
    },
    {
      command: 'node ../apps/web/.next/standalone/apps/web/server.js',
      url: 'http://localhost:3100/painel/entrar',
      reuseExistingServer: false,
      env: { API_URL: 'http://localhost:3101', PORT: '3100', HOSTNAME: '127.0.0.1' },
    },
  ],
});
