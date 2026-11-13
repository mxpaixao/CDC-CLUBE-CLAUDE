import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AtorAtual, Equipe } from '../auth/decoradores';
import type { Ator } from '../comum/auditoria.service';
import { naoEncontrado } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { validar } from '../comum/zod';
import { LivroRazaoService } from './livro-razao.service';

const ajusteSchema = z.object({
  valorCentavos: z.number().int(),
  motivo: z.string().optional().default(''),
});

@ApiTags('carteiras')
@Controller('carteiras')
export class CarteirasController {
  constructor(
    private readonly livro: LivroRazaoService,
    private readonly prisma: PrismaService,
  ) {}

  @Equipe('cadastro', 'operacao_caixa', 'ajuste_saldo', 'visualizacao_relatorios')
  @Get(':id')
  async saldo(@Param('id') id: string) {
    const carteira = await this.prisma.carteira.findUnique({ where: { id } });
    if (!carteira) throw naoEncontrado('carteira');
    return { carteira, saldos: await this.livro.resumo(id) };
  }

  @Equipe('cadastro', 'operacao_caixa', 'ajuste_saldo', 'visualizacao_relatorios')
  @Get(':id/lancamentos')
  extrato(@Param('id') id: string, @Query('pagina') pagina?: string) {
    return this.livro.extrato(id, Math.max(1, Number(pagina ?? 1)));
  }

  @Equipe('ajuste_saldo')
  @Post(':id/ajustes')
  ajuste(
    @Param('id') id: string,
    @Body(validar(ajusteSchema)) corpo: z.infer<typeof ajusteSchema>,
    @AtorAtual() ator: Ator,
    @Headers('idempotency-key') chave?: string,
  ) {
    return this.livro.ajusteManual(
      {
        carteiraId: id,
        valorCentavos: corpo.valorCentavos,
        motivo: corpo.motivo,
        chave: chave ?? randomUUID(),
      },
      ator,
    );
  }
}
