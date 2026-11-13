import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSOES } from '@cdc/shared';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { AtorAtual, Equipe } from '../auth/decoradores';
import { AuditoriaService, type Ator } from '../comum/auditoria.service';
import { naoEncontrado } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { validar } from '../comum/zod';
import { JobsService } from '../jobs/jobs.service';
import { RelatoriosService } from './relatorios.service';

const usuario = z.object({
  nome: z.string().min(3),
  email: z.string().email(),
  senha: z.string().min(10),
  permissoes: z.array(z.enum(PERMISSOES)).min(1),
  lojaId: z.string().nullish(),
});
const edicaoUsuario = z.object({
  nome: z.string().min(3).optional(),
  permissoes: z.array(z.enum(PERMISSOES)).min(1).optional(),
  lojaId: z.string().nullish(),
  ativo: z.boolean().optional(),
  senha: z.string().min(10).optional(),
});

@ApiTags('administracao')
@Controller()
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly relatorios: RelatoriosService,
    private readonly auditoria: AuditoriaService,
    private readonly jobs: JobsService,
  ) {}

  @Equipe('visualizacao_relatorios')
  @Get('relatorios/visao-geral')
  visaoGeral(@Query('dias') dias?: string) {
    return this.relatorios.visaoGeral(Math.min(365, Math.max(1, Number(dias ?? 30))));
  }

  @Equipe('visualizacao_relatorios', 'operacao_caixa')
  @Get('relatorios/bonus-resgates')
  bonus() {
    return this.relatorios.bonusResgates();
  }

  @Equipe('visualizacao_relatorios', 'cadastro', 'ajuste_saldo')
  @Get('vendas')
  vendas(
    @Query('documento') documento?: string,
    @Query('lojaId') lojaId?: string,
    @Query('prestadorId') prestadorId?: string,
  ) {
    return this.prisma.venda.findMany({
      where: {
        documentoErp: documento || undefined,
        lojaId: lojaId || undefined,
        prestadorIndicadorId: prestadorId || undefined,
      },
      orderBy: { dataConfirmacao: 'desc' },
      take: 100,
      select: {
        id: true,
        lojaId: true,
        documentoErp: true,
        dataConfirmacao: true,
        perfilAplicado: true,
        baseCalculoCentavos: true,
        cashbackCentavos: true,
        recompensaCentavos: true,
        recompensaExcedenteCentavos: true,
        status: true,
        prestadorIndicadorId: true,
        codigoResgate: true,
        situacaoCredito: true,
      },
    });
  }

  @Equipe('visualizacao_relatorios', 'cadastro', 'ajuste_saldo')
  @Get('vendas/:id')
  async venda(@Param('id') id: string) {
    const v = await this.prisma.venda.findUnique({
      where: { id },
      include: {
        itens: true,
        pagamentos: true,
        devolucoes: { include: { itens: true } },
        lancamentos: true,
        prestador: { select: { codigo: true, id: true } },
      },
    });
    if (!v) throw naoEncontrado('venda');
    return v;
  }

  @Equipe('admin')
  @Get('auditoria')
  trilha(
    @Query('entidade') entidade?: string,
    @Query('entidadeId') entidadeId?: string,
    @Query('acao') acao?: string,
    @Query('usuarioId') usuarioId?: string,
    @Query('pagina') pagina?: string,
  ) {
    const p = Math.max(1, Number(pagina ?? 1));
    return this.prisma.auditoria.findMany({
      where: {
        entidade: entidade || undefined,
        entidadeId: entidadeId || undefined,
        acao: acao || undefined,
        usuarioId: usuarioId || undefined,
      },
      orderBy: { criadoEm: 'desc' },
      skip: (p - 1) * 100,
      take: 100,
    });
  }

  @Equipe('admin')
  @Get('usuarios')
  usuarios() {
    return this.prisma.usuarioCdc.findMany({
      select: {
        id: true,
        nome: true,
        email: true,
        permissoes: true,
        lojaId: true,
        ativo: true,
        ultimoAcesso: true,
      },
      orderBy: { nome: 'asc' },
    });
  }

  @Equipe('admin')
  @Get('permissoes')
  permissoes() {
    return this.prisma.permissao.findMany();
  }

  @Equipe('admin')
  @Post('usuarios')
  async criarUsuario(@Body(validar(usuario)) c: z.infer<typeof usuario>, @AtorAtual() ator: Ator) {
    const u = await this.prisma.usuarioCdc.create({
      data: {
        nome: c.nome,
        email: c.email.toLowerCase(),
        senhaHash: await AuthService.hashSenha(c.senha),
        permissoes: c.permissoes,
        lojaId: c.lojaId ?? null,
      },
    });
    await this.auditoria.registrar(ator, 'USUARIO_CRIADO', 'UsuarioCdc', u.id, {
      depois: { email: u.email, permissoes: u.permissoes },
    });
    return { id: u.id, nome: u.nome, email: u.email, permissoes: u.permissoes };
  }

  @Equipe('admin')
  @Patch('usuarios/:id')
  async editarUsuario(
    @Param('id') id: string,
    @Body(validar(edicaoUsuario)) c: z.infer<typeof edicaoUsuario>,
    @AtorAtual() ator: Ator,
  ) {
    const antes = await this.prisma.usuarioCdc.findUnique({ where: { id } });
    if (!antes) throw naoEncontrado('usuário');
    const u = await this.prisma.usuarioCdc.update({
      where: { id },
      data: {
        nome: c.nome,
        permissoes: c.permissoes,
        lojaId: c.lojaId === undefined ? undefined : c.lojaId,
        ativo: c.ativo,
        senhaHash: c.senha ? await AuthService.hashSenha(c.senha) : undefined,
      },
    });
    await this.auditoria.registrar(ator, 'USUARIO_EDITADO', 'UsuarioCdc', id, {
      antes: { permissoes: antes.permissoes, ativo: antes.ativo },
      depois: { permissoes: u.permissoes, ativo: u.ativo, senhaAlterada: !!c.senha },
    });
    return { id: u.id, nome: u.nome, email: u.email, permissoes: u.permissoes, ativo: u.ativo };
  }

  @Equipe()
  @Get('lojas')
  lojas() {
    return this.prisma.loja.findMany({ orderBy: { id: 'asc' } });
  }

  @Equipe('alteracao_regras', 'visualizacao_relatorios')
  @Get('catalogo/familias')
  familias() {
    return this.prisma.familia.findMany({
      include: { subfamilias: true },
      orderBy: { codigo: 'asc' },
    });
  }

  @Equipe('admin')
  @Post('jobs/:nome')
  executarJob(@Param('nome') nome: string) {
    return this.jobs.executar(nome);
  }

  @Equipe('admin')
  @Get('notificacoes')
  notificacoes(
    @Query('status')
    status?: 'PENDENTE' | 'ENVIADA' | 'FALHOU' | 'CANCELADA' | 'BLOQUEADA_CONSENTIMENTO',
  ) {
    return this.prisma.notificacao.findMany({
      where: { status },
      orderBy: { criadoEm: 'desc' },
      take: 200,
    });
  }

  @Equipe('admin')
  @Get('notificacoes/templates')
  templates() {
    return this.prisma.templateNotificacao.findMany({ orderBy: { codigo: 'asc' } });
  }

  @Equipe('admin')
  @Patch('notificacoes/templates/:codigo')
  async editarTemplate(
    @Param('codigo') codigo: string,
    @Body(validar(z.object({ corpo: z.string().min(10).max(1000), ativo: z.boolean().optional() })))
    c: { corpo: string; ativo?: boolean },
    @AtorAtual() ator: Ator,
  ) {
    const antes = await this.prisma.templateNotificacao.findUnique({ where: { codigo } });
    if (!antes) throw naoEncontrado('template');
    const t = await this.prisma.templateNotificacao.update({
      where: { codigo },
      data: { corpo: c.corpo, ativo: c.ativo },
    });
    await this.auditoria.registrar(ator, 'TEMPLATE_EDITADO', 'TemplateNotificacao', codigo, {
      antes: { corpo: antes.corpo },
      depois: { corpo: t.corpo, ativo: t.ativo },
    });
    return t;
  }
}
