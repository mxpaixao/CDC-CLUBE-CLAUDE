import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        process.env.DATABASE_URL_TEST ??
        'postgresql://cdc:cdc@localhost:5432/clube_cdc_test?schema=public',
      JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres-0000000',
      NOTIFICADOR: 'console',
    },
  },
});
