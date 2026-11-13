import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { ZodError } from 'zod';

/** Erro de regra de negócio, com código estável para o front e para os testes. */
export class ErroNegocio extends Error {
  constructor(
    public readonly codigo: string,
    mensagem: string,
    public readonly status: number = HttpStatus.UNPROCESSABLE_ENTITY,
    public readonly dados?: Record<string, unknown>,
  ) {
    super(mensagem);
    this.name = 'ErroNegocio';
  }
}

export const naoEncontrado = (o: string) =>
  new ErroNegocio('NAO_ENCONTRADO', `${o} não encontrado(a)`, 404);
export const proibido = (m = 'sem permissão') => new ErroNegocio('PROIBIDO', m, 403);

@Catch()
export class FiltroErros implements ExceptionFilter {
  private readonly logger = new Logger('Erros');

  catch(erro: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (erro instanceof ErroNegocio) {
      return res
        .status(erro.status)
        .json({ erro: erro.codigo, mensagem: erro.message, dados: erro.dados });
    }
    if (erro instanceof ZodError) {
      return res.status(400).json({
        erro: 'VALIDACAO',
        mensagem: erro.issues.map((i) => `${i.path.join('.') || 'corpo'}: ${i.message}`).join('; '),
        dados: { campos: erro.issues },
      });
    }
    if (erro instanceof HttpException) {
      const status = erro.getStatus();
      const r = erro.getResponse();
      const mensagem =
        typeof r === 'string'
          ? r
          : ((r as { message?: string | string[] }).message ?? erro.message);
      return res
        .status(status)
        .json({
          erro: HttpStatus[status] ?? 'ERRO',
          mensagem: Array.isArray(mensagem) ? mensagem.join('; ') : mensagem,
        });
    }
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
      return res
        .status(409)
        .json({
          erro: 'CONFLITO',
          mensagem: 'registro duplicado',
          dados: { alvo: erro.meta?.target },
        });
    }
    this.logger.error(erro instanceof Error ? erro.stack : String(erro));
    return res
      .status(500)
      .json({ erro: 'ERRO_INTERNO', mensagem: 'erro interno — consulte os logs' });
  }
}
