import { execSync } from 'node:child_process';

export default function () {
  const url =
    process.env.DATABASE_URL_TEST ??
    'postgresql://cdc:cdc@localhost:5432/clube_cdc_test?schema=public';
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}
