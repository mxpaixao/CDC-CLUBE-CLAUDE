import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ErroNegocio } from '../comum/erros';
import { CHAVE_ACESSO, type RegraAcesso, type UsuarioToken } from './decoradores';

export const COOKIE_PAINEL = 'cdc_painel';
export const COOKIE_APP = 'cdc_app';
const ESCRITA = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Guard global: toda rota é privada por padrão.
 * Token via `Authorization: Bearer` (integrações/testes) ou cookie httpOnly (navegador).
 * Com cookie, escrita exige o header `X-CDC-Requisicao: 1` (proteção CSRF).
 */
@Injectable()
export class AcessoGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const regra = this.reflector.getAllAndOverride<RegraAcesso | undefined>(CHAVE_ACESSO, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const req = ctx.switchToHttp().getRequest<Request & { usuario?: UsuarioToken }>();
    if (regra?.publico) return true;
    if (!regra?.tipo)
      throw new ErroNegocio('ROTA_SEM_REGRA_DE_ACESSO', 'rota sem regra de acesso declarada', 403);

    const bearer = req.header('authorization')?.replace(/^Bearer\s+/i, '');
    const cookie =
      regra.tipo === 'STAFF' ? req.cookies?.[COOKIE_PAINEL] : req.cookies?.[COOKIE_APP];
    const token = bearer || cookie;
    if (!token) throw new ErroNegocio('NAO_AUTENTICADO', 'autenticação necessária', 401);
    if (!bearer && ESCRITA.has(req.method) && req.header('x-cdc-requisicao') !== '1') {
      throw new ErroNegocio('CSRF', 'requisição sem cabeçalho de origem', 403);
    }
    let usuario: UsuarioToken;
    try {
      usuario = await this.jwt.verifyAsync<UsuarioToken>(token);
    } catch {
      throw new ErroNegocio('TOKEN_INVALIDO', 'sessão expirada ou inválida', 401);
    }
    if (usuario.tipo !== regra.tipo)
      throw new ErroNegocio('PROIBIDO', 'acesso não permitido para este perfil', 403);
    if (regra.tipo === 'STAFF' && regra.permissoes?.length) {
      const tem = usuario.permissoes ?? [];
      if (!tem.includes('admin') && !regra.permissoes.some((p) => tem.includes(p))) {
        throw new ErroNegocio(
          'PROIBIDO',
          `permissão necessária: ${regra.permissoes.join(' ou ')}`,
          403,
        );
      }
    }
    req.usuario = usuario;
    return true;
  }
}
