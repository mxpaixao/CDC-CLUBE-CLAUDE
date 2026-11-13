import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NIVEIS_PRESTADOR, normalizarCodigoPrestador, primeiroNome } from '@cdc/shared';
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
import { naoEncontrado } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { validar } from '../comum/zod';
import { PrestadoresService } from './prestadores.service';

const candidatura = z.object({
  cnpj: z.string().nullish(),
  razaoSocial: z.string().nullish(),
  especialidades: z.array(z.string()).max(10),
  bairros: z.array(z.string().min(2).max(60)).max(30),
  whatsapp: z.string(),
  fotos: z.array(z.string().max(500)).max(10).optional(),
  documentos: z.array(z.string().max(500)).max(10).optional(),
  aceiteTermos: z.boolean(),
  aceiteCodigoConduta: z.boolean(),
  perfilPublico: z.boolean().optional(),
});
const motivo = z.object({ motivo: z.string().min(5) });
const nivel = z.object({ nivel: z.enum(NIVEIS_PRESTADOR), motivo: z.string().min(5) });
const indicador = z.object({ codigo: z.string().nullable(), justificativa: z.string().min(10) });

@ApiTags('prestadores')
@Controller()
export class PrestadoresController {
  constructor(
    private readonly prestadores: PrestadoresService,
    private readonly prisma: PrismaService,
  ) {}

  @Publico()
  @Get('prestadores/especialidades')
  especialidades() {
    return this.prestadores.especialidades();
  }

  /** Página pública do link de indicação: só primeiro nome e especialidades. */
  @Publico()
  @Get('indicacoes/:codigo')
  async publico(@Param('codigo') codigo: string) {
    const p = await this.prisma.prestador.findUnique({
      where: { codigo: normalizarCodigoPrestador(codigo) },
      include: { pessoa: { select: { nome: true } } },
    });
    if (!p || p.status !== 'APROVADO') throw naoEncontrado('prestador');
    return {
      codigo: p.codigo,
      nome: primeiroNome(p.pessoa.nome),
      especialidades: p.especialidades,
      bairros: p.bairros,
      nivel: p.nivel,
    };
  }

  @Participante()
  @Get('app/prestador')
  area(@Usuario() u: UsuarioToken) {
    return this.prestadores.areaDoPrestador(u.pessoaId!);
  }

  @Participante()
  @Post('app/prestador/candidatura')
  candidatar(
    @Usuario() u: UsuarioToken,
    @Body(validar(candidatura)) c: z.infer<typeof candidatura>,
    @AtorAtual() ator: Ator,
  ) {
    return this.prestadores.candidatar(u.pessoaId!, c, ator);
  }

  @Equipe('aprovacao_prestador', 'visualizacao_relatorios', 'operacao_caixa')
  @Get('prestadores')
  listar(
    @Query('status') status?: 'PENDENTE' | 'APROVADO' | 'RECUSADO' | 'SUSPENSO',
    @Query('busca') busca?: string,
  ) {
    return this.prestadores.listar({ status, busca });
  }

  @Equipe('aprovacao_prestador', 'visualizacao_relatorios')
  @Get('prestadores/:id')
  detalhe(@Param('id') id: string) {
    return this.prestadores.detalhe(id);
  }

  @Equipe('aprovacao_prestador')
  @Post('prestadores/:id/aprovar')
  aprovar(@Param('id') id: string, @AtorAtual() ator: Ator) {
    return this.prestadores.aprovar(id, ator);
  }

  @Equipe('aprovacao_prestador')
  @Post('prestadores/:id/recusar')
  recusar(
    @Param('id') id: string,
    @Body(validar(motivo)) c: z.infer<typeof motivo>,
    @AtorAtual() ator: Ator,
  ) {
    return this.prestadores.mudarStatus(id, 'RECUSADO', c.motivo, ator);
  }

  @Equipe('aprovacao_prestador')
  @Post('prestadores/:id/suspender')
  suspender(
    @Param('id') id: string,
    @Body(validar(motivo)) c: z.infer<typeof motivo>,
    @AtorAtual() ator: Ator,
  ) {
    return this.prestadores.mudarStatus(id, 'SUSPENSO', c.motivo, ator);
  }

  @Equipe('aprovacao_prestador')
  @Post('prestadores/:id/nivel')
  definirNivel(
    @Param('id') id: string,
    @Body(validar(nivel)) c: z.infer<typeof nivel>,
    @AtorAtual() ator: Ator,
  ) {
    return this.prestadores.definirNivel(id, c.nivel, c.motivo, ator);
  }

  @Equipe('ajuste_saldo')
  @Post('vendas/:id/indicador')
  alterarIndicador(
    @Param('id') id: string,
    @Body(validar(indicador)) c: z.infer<typeof indicador>,
    @AtorAtual() ator: Ator,
  ) {
    return this.prestadores.alterarIndicador(id, c.codigo, c.justificativa, ator);
  }
}
