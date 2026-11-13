import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/comum/prisma.service';
import { Relogio } from '../src/comum/relogio';
import { RegrasService } from '../src/regras/regras.service';
import { semearBase } from '../prisma/seed-dados';

export const IMPLANTACAO = new Date('2026-01-01T04:00:00Z');
export const SENHA_ADMIN = 'senha-admin-teste-123';

export interface Ambiente {
  app: INestApplication;
  prisma: PrismaService;
  relogio: Relogio;
  http: () => ReturnType<typeof request>;
  tokenAdmin: string;
  get<T>(tipo: new (...args: never[]) => T): T;
}

export async function limparBanco(prisma: PrismaService) {
  const tabelas = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const lista = tabelas.map((t) => `"${t.tablename}"`).join(', ');
  await prisma.$transaction([
    prisma.$executeRawUnsafe(`SET LOCAL cdc.permitir_limpeza = 'on'`),
    prisma.$executeRawUnsafe(`TRUNCATE ${lista} RESTART IDENTITY CASCADE`),
  ]);
}

export async function criarAmbiente(agora = new Date('2026-03-10T15:00:00Z')): Promise<Ambiente> {
  const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = modulo.createNestApplication({ logger: false });
  app.use(cookieParser());
  await app.init();
  const prisma = app.get(PrismaService);
  const relogio = app.get(Relogio);
  relogio.definir(agora);
  await limparBanco(prisma);
  await semearBase(prisma, IMPLANTACAO, SENHA_ADMIN);
  app.get(RegrasService).invalidarCache();
  const login = await request(app.getHttpServer())
    .post('/auth/equipe/login')
    .send({ email: 'admin@cdc.local', senha: SENHA_ADMIN });
  return {
    app,
    prisma,
    relogio,
    http: () => request(app.getHttpServer()),
    tokenAdmin: login.body?.token,
    get: (tipo) => app.get(tipo),
  };
}
