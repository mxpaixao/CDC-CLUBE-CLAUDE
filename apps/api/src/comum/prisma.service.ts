import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Transação com retry em falhas de serialização/deadlock (P2034 / 40001 / 40P01).
   */
  async transacao<T>(
    fn: (tx: Tx) => Promise<T>,
    opcoes: { tentativas?: number; timeoutMs?: number } = {},
  ): Promise<T> {
    const tentativas = opcoes.tentativas ?? 4;
    for (let i = 1; ; i++) {
      try {
        return await this.$transaction(fn, {
          timeout: opcoes.timeoutMs ?? 20_000,
          maxWait: 10_000,
        });
      } catch (e) {
        const codigo = (e as { code?: string }).code;
        const msg = String((e as Error).message ?? '');
        const reprocessavel =
          codigo === 'P2034' ||
          msg.includes('40001') ||
          msg.includes('40P01') ||
          msg.includes('deadlock');
        if (!reprocessavel || i >= tentativas) throw e;
        await new Promise((r) => setTimeout(r, 25 * i + Math.floor(Math.random() * 25)));
      }
    }
  }
}
