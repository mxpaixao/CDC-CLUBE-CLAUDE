import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { COOKIE_APP } from '../auth/acesso.guard';
import { config } from '../comum/config';
import { ApiTags } from '@nestjs/swagger';
import { TIPOS_CONSENTIMENTO } from '@cdc/shared';
import { z } from 'zod';
import {
  AtorAtual,
  Equipe,
  Participante,
  Publico,
  Usuario,
  type UsuarioToken,
} from '../auth/decoradores';
import type { Ator } from '../comum/auditoria.service';
import { ErroNegocio } from '../comum/erros';
import { validar } from '../comum/zod';
import { LivroRazaoService } from '../carteiras/livro-razao.service';
import { PrestadoresService } from '../prestadores/prestadores.service';
import { RegrasService } from '../regras/regras.service';
import { PrismaService } from '../comum/prisma.service';
import { ParticipantesService } from './participantes.service';

const consentimentos = z
  .object(Object.fromEntries(TIPOS_CONSENTIMENTO.map((t) => [t, z.boolean().optional()])))
  .partial();
const otpCadastro = z.object({ cpf: z.string(), telefone: z.string() });
const adesao = z.object({
  tipo: z.enum(['CPF', 'EMPRESA']),
  cpf: z.string(),
  nome: z.string().min(2).max(120),
  email: z.string().email().nullish(),
  dataNascimento: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  cnpj: z.string().nullish(),
  razaoSocial: z.string().max(200).nullish(),
  codigo: z.string().regex(/^\d{6}$/),
  consentimentos,
});
const perfil = z.object({
  nome: z.string().min(2).max(120).optional(),
  email: z.string().email().nullish(),
});
const comprador = z.object({
  cpf: z.string(),
  nome: z.string().min(2),
  telefone: z.string().nullish(),
});

@ApiTags('participantes')
@Controller()
export class ParticipantesController {
  constructor(
    private readonly participantes: ParticipantesService,
    private readonly livro: LivroRazaoService,
    private readonly regras: RegrasService,
    private readonly prestadores: PrestadoresService,
    private readonly prisma: PrismaService,
  ) {}

  // ── adesão (pública, protegida por OTP)
  @Publico()
  @Post('participantes/adesao/otp')
  otp(@Body(validar(otpCadastro)) c: z.infer<typeof otpCadastro>) {
    return this.participantes.solicitarOtpCadastro(c.cpf, c.telefone);
  }

  @Publico()
  @Post('participantes/adesao')
  async aderir(
    @Body(validar(adesao)) c: z.infer<typeof adesao>,
    @AtorAtual() ator: Ator,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.participantes.aderir(
      { ...c, canalAdesao: 'APP' },
      { ...ator, tipo: 'PARTICIPANTE' },
    );
    // a adesão já abre a sessão do participante
    res.cookie(COOKIE_APP, r.token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.cookieSeguro,
      maxAge: 30 * 86_400_000,
      path: '/',
    });
    return r;
  }

  // ── equipe
  @Equipe('cadastro')
  @Post('participantes/equipe/adesao/otp')
  otpEquipe(@Body(validar(otpCadastro)) c: z.infer<typeof otpCadastro>) {
    return this.participantes.solicitarOtpCadastro(c.cpf, c.telefone);
  }

  @Equipe('cadastro')
  @Post('participantes/equipe/adesao')
  async aderirEquipe(@Body(validar(adesao)) c: z.infer<typeof adesao>, @AtorAtual() ator: Ator) {
    const r = await this.participantes.aderir({ ...c, canalAdesao: 'LOJA' }, ator);
    return { participante: r.participante, pessoa: r.pessoa };
  }

  @Equipe('cadastro', 'operacao_caixa', 'visualizacao_relatorios', 'ajuste_saldo')
  @Get('participantes')
  buscar(@Query('busca') busca = '') {
    return this.participantes.buscar(busca);
  }

  @Equipe('cadastro', 'operacao_caixa', 'visualizacao_relatorios', 'ajuste_saldo')
  @Get('participantes/:tipo/:id')
  detalhe(@Param('tipo') tipo: string, @Param('id') id: string) {
    if (tipo !== 'PESSOA' && tipo !== 'EMPRESA')
      throw new ErroNegocio('TIPO_INVALIDO', 'tipo deve ser PESSOA ou EMPRESA', 400);
    return this.participantes.detalheEquipe(tipo, id);
  }

  @Equipe('cadastro')
  @Post('empresas/:id/compradores')
  addComprador(
    @Param('id') id: string,
    @Body(validar(comprador)) c: z.infer<typeof comprador>,
    @AtorAtual() ator: Ator,
  ) {
    return this.participantes.adicionarComprador(id, c, ator);
  }

  @Equipe('cadastro')
  @Put('participantes/pessoa/:id/consentimentos')
  consentEquipe(
    @Param('id') id: string,
    @Body(validar(consentimentos)) c: z.infer<typeof consentimentos>,
    @AtorAtual() ator: Ator,
  ) {
    return this.participantes.atualizarConsentimentos(id, c, ator);
  }

  // ── PWA do participante
  @Participante()
  @Get('app/inicio')
  async inicio(@Usuario() u: UsuarioToken) {
    const perfil = await this.participantes.perfil(u.pessoaId!);
    const carteiras = await this.participantes.carteirasDoTitular({ pessoaId: u.pessoaId! });
    const daEmpresa = [];
    for (const e of perfil.empresas)
      daEmpresa.push(
        ...(await this.participantes.carteirasDoTitular({ empresaId: e.empresaId })).map((c) => ({
          ...c,
          empresa: { razaoSocial: e.razaoSocial, cnpj: e.cnpj },
        })),
      );
    return {
      nome: perfil.nome,
      participante: perfil.participante,
      prestador: perfil.prestador,
      carteiras: [...carteiras, ...daEmpresa],
    };
  }

  @Participante()
  @Get('app/extrato/:carteiraId')
  async extrato(
    @Usuario() u: UsuarioToken,
    @Param('carteiraId') carteiraId: string,
    @Query('pagina') pagina?: string,
  ) {
    await this.garantirAcesso(u.pessoaId!, carteiraId);
    return this.livro.extrato(carteiraId, Math.max(1, Number(pagina ?? 1)));
  }

  @Participante()
  @Post('app/codigo-caixa')
  codigoCaixa(@Usuario() u: UsuarioToken) {
    return this.participantes.gerarCodigoCaixa(u.pessoaId!);
  }

  @Publico()
  @Get('app/regras')
  regrasTexto() {
    return this.regras.regrasEmLinguagemSimples();
  }

  @Participante()
  @Get('app/perfil')
  meuPerfil(@Usuario() u: UsuarioToken) {
    return this.participantes.perfil(u.pessoaId!);
  }

  @Participante()
  @Put('app/perfil')
  atualizarPerfil(
    @Usuario() u: UsuarioToken,
    @Body(validar(perfil)) c: z.infer<typeof perfil>,
    @AtorAtual() ator: Ator,
  ) {
    return this.participantes.atualizarPerfil(u.pessoaId!, c, ator);
  }

  @Participante()
  @Put('app/consentimentos')
  consentimentos(
    @Usuario() u: UsuarioToken,
    @Body(validar(consentimentos)) c: z.infer<typeof consentimentos>,
    @AtorAtual() ator: Ator,
  ) {
    return this.participantes.atualizarConsentimentos(u.pessoaId!, c, ator);
  }

  @Participante()
  @Delete('app/conta')
  excluir(
    @Usuario() u: UsuarioToken,
    @Body(validar(z.object({ confirmo: z.boolean() }))) c: { confirmo: boolean },
    @AtorAtual() ator: Ator,
  ) {
    return this.participantes.excluirConta(u.pessoaId!, c.confirmo, ator);
  }

  @Participante()
  @Post('app/vinculos')
  vincular(
    @Usuario() u: UsuarioToken,
    @Body(validar(z.object({ codigo: z.string().min(3) }))) c: { codigo: string },
    @AtorAtual() ator: Ator,
  ) {
    return this.prestadores.vincularPeloApp(u.pessoaId!, c.codigo, ator);
  }

  private async garantirAcesso(pessoaId: string, carteiraId: string) {
    const c = await this.prisma.carteira.findUnique({ where: { id: carteiraId } });
    if (!c) throw new ErroNegocio('NAO_ENCONTRADO', 'carteira não encontrada', 404);
    if (c.pessoaId === pessoaId) return;
    if (
      c.empresaId &&
      (await this.prisma.empresaComprador.findFirst({
        where: { empresaId: c.empresaId, pessoaId, ativo: true },
      }))
    )
      return;
    throw new ErroNegocio('PROIBIDO', 'carteira de outro titular', 403);
  }
}
