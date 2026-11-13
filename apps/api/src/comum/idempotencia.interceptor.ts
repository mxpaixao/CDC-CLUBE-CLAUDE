import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { catchError, from, Observable, of, switchMap, throwError } from 'rxjs';
import { ErroNegocio } from './erros';
import { paraJson } from './json';
import { PrismaService } from './prisma.service';

const METODOS_ESCRITA = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Header `Idempotency-Key` em rotas de escrita: a mesma chave (por ator + rota) devolve a
 * mesma resposta; com corpo diferente → 409. Requisição concorrente com a mesma chave → 409.
 */
@Injectable()
export class IdempotenciaInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request & { usuario?: { sub: string } }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const chaveCliente = req.header('idempotency-key');
    if (!chaveCliente || !METODOS_ESCRITA.has(req.method)) return next.handle();
    if (chaveCliente.length > 200)
      throw new ErroNegocio('IDEMPOTENCIA_INVALIDA', 'Idempotency-Key muito longa', 400);

    const escopo = `${req.method} ${req.route?.path ?? req.path} ${req.usuario?.sub ?? 'anon'}`;
    const chave = createHash('sha256').update(`${escopo}|${chaveCliente}`).digest('hex');
    const hashCorpo = createHash('sha256')
      .update(JSON.stringify(req.body ?? {}))
      .digest('hex');

    return from(this.reservar(chave, escopo, hashCorpo)).pipe(
      switchMap((existente) => {
        if (existente) {
          if (existente.hashCorpo !== hashCorpo) {
            throw new ErroNegocio(
              'IDEMPOTENCIA_CONFLITO',
              'Idempotency-Key já usada com outro conteúdo',
              409,
            );
          }
          if (existente.statusHttp === 0) {
            throw new ErroNegocio(
              'IDEMPOTENCIA_EM_ANDAMENTO',
              'requisição com esta Idempotency-Key em processamento',
              409,
            );
          }
          res.status(existente.statusHttp);
          res.setHeader('Idempotent-Replay', 'true');
          return of(existente.resposta);
        }
        return next.handle().pipe(
          switchMap((corpo) =>
            from(
              this.prisma.idempotenciaRequisicao
                .update({
                  where: { chave },
                  data: {
                    statusHttp: res.statusCode || 200,
                    resposta: (paraJson(corpo ?? null) ?? Prisma.JsonNull) as Prisma.InputJsonValue,
                  },
                })
                .then(() => corpo),
            ),
          ),
          catchError((e) =>
            from(
              this.prisma.idempotenciaRequisicao
                .delete({ where: { chave } })
                .catch(() => undefined),
            ).pipe(switchMap(() => throwError(() => e))),
          ),
        );
      }),
    );
  }

  private async reservar(chave: string, escopo: string, hashCorpo: string) {
    try {
      await this.prisma.idempotenciaRequisicao.create({
        data: { chave, escopo, hashCorpo, statusHttp: 0, resposta: Prisma.JsonNull },
      });
      return null;
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e;
      return this.prisma.idempotenciaRequisicao.findUnique({ where: { chave } });
    }
  }
}
