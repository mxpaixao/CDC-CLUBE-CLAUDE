import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permissao } from '@cdc/shared';
import type { Request } from 'express';
import type { Ator } from '../comum/auditoria.service';

export interface UsuarioToken {
  sub: string;
  tipo: 'STAFF' | 'PARTICIPANTE';
  nome?: string;
  permissoes?: string[];
  lojaId?: string | null;
  pessoaId?: string;
  participanteId?: string | null;
  empresaId?: string | null;
}

export const CHAVE_ACESSO = 'cdc:acesso';
export interface RegraAcesso {
  publico?: boolean;
  tipo?: 'STAFF' | 'PARTICIPANTE';
  permissoes?: Permissao[];
}

/** Rota pública (sem token). */
export const Publico = () => SetMetadata(CHAVE_ACESSO, { publico: true } satisfies RegraAcesso);
/** Equipe CDC com QUALQUER uma das permissões listadas (admin sempre passa). */
export const Equipe = (...permissoes: Permissao[]) =>
  SetMetadata(CHAVE_ACESSO, { tipo: 'STAFF', permissoes } satisfies RegraAcesso);
/** Participante autenticado por OTP. */
export const Participante = () =>
  SetMetadata(CHAVE_ACESSO, { tipo: 'PARTICIPANTE' } satisfies RegraAcesso);

export const Usuario = createParamDecorator((_d: unknown, ctx: ExecutionContext): UsuarioToken => {
  return ctx.switchToHttp().getRequest<Request & { usuario: UsuarioToken }>().usuario;
});

export const AtorAtual = createParamDecorator((_d: unknown, ctx: ExecutionContext): Ator => {
  const req = ctx.switchToHttp().getRequest<Request & { usuario?: UsuarioToken }>();
  return { tipo: req.usuario?.tipo ?? 'SISTEMA', id: req.usuario?.sub ?? null, ip: req.ip ?? null };
});
