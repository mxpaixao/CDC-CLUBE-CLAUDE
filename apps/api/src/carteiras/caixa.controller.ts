import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AtorAtual, Equipe, Usuario, type UsuarioToken } from '../auth/decoradores';
import type { Ator } from '../comum/auditoria.service';
import { validar } from '../comum/zod';
import { CaixaService } from './caixa.service';
import { LivroRazaoService } from './livro-razao.service';

const reserva = z.object({
  carteiraId: z.string().uuid(),
  valorCompraCentavos: z.number().int().positive(),
  valorCentavos: z.number().int().positive(),
  lojaId: z.string().min(1),
  codigoTitular: z
    .string()
    .regex(/^\d{6}$/)
    .nullish(),
  liberacaoSupervisor: z.string().min(10).nullish(),
});
const preRegistro = z.object({
  lojaId: z.string(),
  documentoErp: z.string().min(1),
  codigo: z.string().min(3),
});

@ApiTags('caixa')
@Controller()
export class CaixaController {
  constructor(
    private readonly caixa: CaixaService,
    private readonly livro: LivroRazaoService,
  ) {}

  @Equipe('operacao_caixa')
  @Get('caixa/consulta')
  consultar(@Query('busca') busca: string, @Query('valorCompraCentavos') valor?: string) {
    return this.caixa.consultar(busca, valor ? Number(valor) : undefined);
  }

  @Equipe('operacao_caixa')
  @Post('caixa/otp')
  otp(@Body(validar(z.object({ carteiraId: z.string().uuid() }))) c: { carteiraId: string }) {
    return this.caixa.enviarOtpResgate(c.carteiraId);
  }

  @Equipe('operacao_caixa')
  @Post('reservas')
  reservar(
    @Body(validar(reserva)) c: z.infer<typeof reserva>,
    @AtorAtual() ator: Ator,
    @Usuario() u: UsuarioToken,
    @Headers('idempotency-key') chave?: string,
  ) {
    return this.caixa.reservar(
      { ...c, chave: chave ?? randomUUID() },
      { ...ator, permissoes: u.permissoes },
    );
  }

  @Equipe('operacao_caixa', 'visualizacao_relatorios')
  @Get('reservas')
  abertas(@Query('lojaId') lojaId?: string) {
    return this.caixa.reservasAbertas(lojaId);
  }

  @Equipe('operacao_caixa', 'visualizacao_relatorios')
  @Get('reservas/codigo/:codigo')
  porCodigo(@Param('codigo') codigo: string) {
    return this.caixa.porCodigo(codigo);
  }

  @Equipe('operacao_caixa')
  @Post('reservas/:id/confirmar')
  confirmar(
    @Param('id') id: string,
    @Body(validar(z.object({ vendaErpRef: z.string().nullish() })))
    c: { vendaErpRef?: string | null },
    @AtorAtual() ator: Ator,
  ) {
    return this.livro.confirmarReserva(id, c.vendaErpRef ?? null, ator);
  }

  @Equipe('operacao_caixa')
  @Post('reservas/:id/cancelar')
  cancelar(
    @Param('id') id: string,
    @Body(validar(z.object({ motivo: z.string().min(3) }))) c: { motivo: string },
    @AtorAtual() ator: Ator,
  ) {
    return this.livro.cancelarReserva(id, c.motivo, ator);
  }

  @Equipe('operacao_caixa')
  @Post('indicacoes/pre-registro')
  preRegistro(@Body(validar(preRegistro)) c: z.infer<typeof preRegistro>, @AtorAtual() ator: Ator) {
    return this.caixa.preRegistrarIndicacao(c, ator);
  }
}
