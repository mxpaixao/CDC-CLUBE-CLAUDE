import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { config } from './comum/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.use(cookieParser());
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.enableShutdownHooks();

  const doc = new DocumentBuilder()
    .setTitle('Clube CDC — API')
    .setDescription(
      'Programa de fidelidade e comunidade da Casa das Correias. Toda rota de escrita aceita o header Idempotency-Key.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .addGlobalParameters({
      name: 'Idempotency-Key',
      in: 'header',
      required: false,
      description: 'Chave de idempotência para rotas de escrita',
    })
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, doc), {
    jsonDocumentUrl: 'docs/openapi.json',
  });

  await app.listen(config.porta, '0.0.0.0');
}
void bootstrap();
