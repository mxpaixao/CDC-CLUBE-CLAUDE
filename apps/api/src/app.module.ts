import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { LoggerModule } from 'nestjs-pino';
import { AcessoGuard } from './auth/acesso.guard';
import { AuthService } from './auth/auth.service';
import { AuditoriaService } from './comum/auditoria.service';
import { config } from './comum/config';
import { FiltroErros } from './comum/erros';
import { EstadoSistemaService } from './comum/estado-sistema.service';
import { IdempotenciaInterceptor } from './comum/idempotencia.interceptor';
import { PrismaService } from './comum/prisma.service';
import { Relogio } from './comum/relogio';
import { LivroRazaoService } from './carteiras/livro-razao.service';
import { NotificacoesService } from './notificacoes/notificacoes.service';
import { RegrasService } from './regras/regras.service';
import { CONTROLLERS, SERVICOS } from './registro';

@Module({
  imports: [
    JwtModule.register({ global: true, secret: config.jwtSecret }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: config.ehTeste ? 'silent' : (process.env.LOG_LEVEL ?? 'info'),
        // logs estruturados (JSON) sem dados sensíveis
        redact: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          'req.body.senha',
          'req.body.codigo',
          'req.body.otp',
        ],
        transport:
          process.env.NODE_ENV === 'development'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
        customProps: () => ({ servico: 'clube-cdc-api' }),
      },
    }),
  ],
  controllers: [...CONTROLLERS],
  providers: [
    PrismaService,
    Relogio,
    AuditoriaService,
    EstadoSistemaService,
    RegrasService,
    NotificacoesService,
    LivroRazaoService,
    AuthService,
    ...SERVICOS,
    { provide: APP_GUARD, useClass: AcessoGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotenciaInterceptor },
    { provide: APP_FILTER, useClass: FiltroErros },
  ],
  exports: [PrismaService, Relogio],
})
export class AppModule {}
