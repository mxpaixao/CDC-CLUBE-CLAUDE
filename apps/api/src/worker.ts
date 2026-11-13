import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { Logger } from 'nestjs-pino';
import { FUSO_CDC } from '@cdc/shared';
import { AppModule } from './app.module';
import { config } from './comum/config';
import { AGENDA, JOBS, JobsService } from './jobs/jobs.service';

/**
 * Worker de jobs agendados (BullMQ + Redis). Cada job é idempotente: rodar duas vezes não
 * duplica crédito, vencimento ou aviso. Concurrency 1 por fila evita corridas entre execuções.
 */
async function iniciar() {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  const jobs = app.get(JobsService);
  const conexao = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  const fila = new Queue('clube-cdc', { connection: conexao });

  for (const nome of JOBS) {
    await fila.upsertJobScheduler(
      nome,
      { pattern: AGENDA[nome], tz: FUSO_CDC },
      {
        name: nome,
        opts: {
          removeOnComplete: 200,
          removeOnFail: 500,
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
        },
      },
    );
  }

  const worker = new Worker('clube-cdc', async (job) => jobs.executar(job.name), {
    connection: conexao,
    concurrency: 1,
  });
  worker.on('failed', (job, err) =>
    logger.error({ job: job?.name, erro: err.message }, 'job falhou'),
  );
  logger.log(`worker iniciado com ${JOBS.length} jobs agendados (${FUSO_CDC})`);

  const encerrar = async () => {
    await worker.close();
    await fila.close();
    await conexao.quit();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', encerrar);
  process.on('SIGINT', encerrar);
}
void iniciar();
