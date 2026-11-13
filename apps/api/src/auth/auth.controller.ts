import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../comum/config';
import { validar } from '../comum/zod';
import { COOKIE_APP, COOKIE_PAINEL } from './acesso.guard';
import { AuthService } from './auth.service';
import { Equipe, Participante, Publico, Usuario, type UsuarioToken } from './decoradores';

const loginEquipe = z.object({ email: z.string().email(), senha: z.string().min(1) });
const otpLogin = z.object({ cpf: z.string().min(11) });
const confirmarLogin = z.object({ cpf: z.string().min(11), codigo: z.string().regex(/^\d{6}$/) });

function definirCookie(
  res: Response,
  nome: string,
  token: string,
  maxAgeMs: number,
  caminho: string,
) {
  res.cookie(nome, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.cookieSeguro,
    maxAge: maxAgeMs,
    path: caminho,
  });
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Publico()
  @Post('equipe/login')
  @HttpCode(200)
  async loginEquipe(
    @Body(validar(loginEquipe)) corpo: z.infer<typeof loginEquipe>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.auth.loginEquipe(corpo.email, corpo.senha, req.ip);
    definirCookie(res, COOKIE_PAINEL, r.token, 10 * 3600_000, '/');
    return r;
  }

  @Publico()
  @Post('equipe/logout')
  @HttpCode(200)
  logoutEquipe(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(COOKIE_PAINEL, { path: '/' });
    return { ok: true };
  }

  @Equipe()
  @Get('equipe/eu')
  eu(@Usuario() u: UsuarioToken) {
    return { id: u.sub, nome: u.nome, permissoes: u.permissoes, lojaId: u.lojaId };
  }

  @Publico()
  @Post('participante/otp')
  @HttpCode(200)
  solicitarOtp(@Body(validar(otpLogin)) corpo: z.infer<typeof otpLogin>) {
    return this.auth.solicitarOtpLogin(corpo.cpf);
  }

  @Publico()
  @Post('participante/entrar')
  @HttpCode(200)
  async entrar(
    @Body(validar(confirmarLogin)) corpo: z.infer<typeof confirmarLogin>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.auth.confirmarOtpLogin(corpo.cpf, corpo.codigo, req.ip);
    definirCookie(res, COOKIE_APP, r.token, 30 * 86_400_000, '/');
    return r;
  }

  @Publico()
  @Post('participante/sair')
  @HttpCode(200)
  sair(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(COOKIE_APP, { path: '/' });
    return { ok: true };
  }

  @Participante()
  @Get('participante/eu')
  euParticipante(@Usuario() u: UsuarioToken) {
    return { pessoaId: u.pessoaId, nome: u.nome, participanteId: u.participanteId };
  }
}
