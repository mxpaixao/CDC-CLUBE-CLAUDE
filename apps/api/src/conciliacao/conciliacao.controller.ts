import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AtorAtual, Equipe } from '../auth/decoradores';
import type { Ator } from '../comum/auditoria.service';
import { EstadoSistemaService } from '../comum/estado-sistema.service';
import { validar } from '../comum/zod';
import { AlertasService } from '../vendas/alertas.service';
import { ConciliacaoService } from './conciliacao.service';

const tratar = z.object({
  status: z.enum(['ABERTA', 'RESOLVIDA', 'IGNORADA']),
  resolucao: z.string().min(3).nullish(),
  responsavelId: z.string().nullish(),
});
const contingencia = z.object({ ativa: z.boolean(), motivo: z.string().min(5) });

@ApiTags('conciliacao')
@Controller()
export class ConciliacaoController {
  constructor(
    private readonly conciliacao: ConciliacaoService,
    private readonly alertas: AlertasService,
    private readonly estado: EstadoSistemaService,
  ) {}

  @Equipe('visualizacao_relatorios')
  @Post('conciliacao/executar')
  executar() {
    return this.conciliacao.executar();
  }

  @Equipe('visualizacao_relatorios')
  @Get('conciliacao/divergencias')
  divergencias(
    @Query('status') status?: 'ABERTA' | 'RESOLVIDA' | 'IGNORADA',
    @Query('tipo') tipo?: string,
  ) {
    return this.alertas.listarDivergencias({ status, tipo });
  }

  @Equipe('visualizacao_relatorios')
  @Patch('conciliacao/divergencias/:id')
  tratar(
    @Param('id') id: string,
    @Body(validar(tratar)) c: z.infer<typeof tratar>,
    @AtorAtual() ator: Ator,
  ) {
    return this.alertas.tratarDivergencia(id, c, ator);
  }

  @Equipe('visualizacao_relatorios', 'aprovacao_prestador')
  @Get('alertas')
  listarAlertas(
    @Query('tipo') tipo?: string,
    @Query('status') status?: 'ABERTO' | 'ANALISADO' | 'DESCARTADO',
  ) {
    return this.alertas.listarAlertas({ tipo, status });
  }

  @Equipe('visualizacao_relatorios', 'aprovacao_prestador')
  @Patch('alertas/:id')
  analisar(
    @Param('id') id: string,
    @Body(validar(z.object({ status: z.enum(['ABERTO', 'ANALISADO', 'DESCARTADO']) })))
    c: { status: 'ABERTO' | 'ANALISADO' | 'DESCARTADO' },
    @AtorAtual() ator: Ator,
  ) {
    return this.alertas.analisarAlerta(id, c.status, ator);
  }

  @Equipe()
  @Get('sistema/contingencia')
  verContingencia() {
    return this.estado.contingencia();
  }

  @Equipe('admin')
  @Put('sistema/contingencia')
  definir(@Body(validar(contingencia)) c: z.infer<typeof contingencia>, @AtorAtual() ator: Ator) {
    return this.estado.definirContingencia(c.ativa, c.motivo, ator);
  }
}
