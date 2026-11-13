import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ESCOPOS_REGRA, PERFIS_COMERCIAIS, NIVEIS_PRESTADOR } from '@cdc/shared';
import { z } from 'zod';
import { AtorAtual, Equipe, Publico } from '../auth/decoradores';
import type { Ator } from '../comum/auditoria.service';
import { Relogio } from '../comum/relogio';
import { validar } from '../comum/zod';
import { RegrasService } from './regras.service';

const novaVersao = z.object({
  escopo: z.enum(ESCOPOS_REGRA),
  nome: z.string().nullish(),
  filtros: z
    .object({
      perfil: z.enum(PERFIS_COMERCIAIS).nullish(),
      lojaId: z.string().nullish(),
      canal: z.string().nullish(),
      familia: z.string().nullish(),
      subfamilia: z.string().nullish(),
      sku: z.string().nullish(),
    })
    .default({}),
  parametros: z.record(z.string(), z.unknown()),
  vigenciaInicio: z.coerce.date().nullish(),
  vigenciaFim: z.coerce.date().nullish(),
  ativa: z.boolean().optional(),
  motivo: z.string().min(5),
});
const campanha = z.object({
  nome: z.string().min(3),
  descricao: z.string().nullish(),
  perfil: z.enum(PERFIS_COMERCIAIS).nullish(),
  inicio: z.coerce.date(),
  fim: z.coerce.date(),
  parametros: z.record(z.string(), z.unknown()),
  motivo: z.string().min(5),
});
const simulacao = z.object({
  lojaId: z.string().default('LOJA-01'),
  canal: z.string().default('LOJA'),
  instante: z.coerce.date().optional(),
  perfil: z.enum(PERFIS_COMERCIAIS).default('CLIENTE_CPF'),
  pagoComCashbackCentavos: z.number().int().min(0).default(0),
  compradorParticipante: z.boolean().default(true),
  boasVindas: z.boolean().default(false),
  indicacao: z.object({ nivel: z.enum(NIVEIS_PRESTADOR) }).nullish(),
  itens: z
    .array(
      z.object({
        id: z.string(),
        sku: z.string(),
        familia: z.string().nullish(),
        subfamilia: z.string().nullish(),
        tipo: z.enum(['MERCADORIA', 'SERVICO', 'FRETE']).default('MERCADORIA'),
        valorBrutoCentavos: z.number().int().min(0),
        descontoCentavos: z.number().int().min(0).default(0),
        custoCentavos: z.number().int().min(0).nullish(),
        emPromocao: z.boolean().optional(),
        descontoNegociado: z.boolean().optional(),
        tabelaProfissional: z.boolean().optional(),
      }),
    )
    .min(1),
});

@ApiTags('regras')
@Controller()
export class RegrasController {
  constructor(
    private readonly regras: RegrasService,
    private readonly relogio: Relogio,
  ) {}

  @Equipe('alteracao_regras', 'visualizacao_relatorios')
  @Get('regras')
  listar() {
    return this.regras.listar();
  }

  @Equipe('alteracao_regras', 'visualizacao_relatorios')
  @Get('regras/vigente')
  vigente() {
    return this.regras.configuracaoAtual();
  }

  @Equipe('alteracao_regras')
  @Post('regras/versoes')
  criar(@Body(validar(novaVersao)) c: z.infer<typeof novaVersao>, @AtorAtual() ator: Ator) {
    return this.regras.criarVersao({ ...c, filtros: c.filtros ?? {} }, ator);
  }

  @Equipe('alteracao_regras')
  @Post('campanhas')
  criarCampanha(@Body(validar(campanha)) c: z.infer<typeof campanha>, @AtorAtual() ator: Ator) {
    return this.regras.criarCampanha(c, ator);
  }

  @Equipe('alteracao_regras', 'visualizacao_relatorios', 'operacao_caixa')
  @Post('regras/simular')
  simular(@Body(validar(simulacao)) c: z.infer<typeof simulacao>) {
    return this.regras.simular({
      ...c,
      instante: c.instante ?? this.relogio.agora(),
      indicacao: c.indicacao ?? null,
    });
  }

  @Publico()
  @Get('regras/texto')
  texto() {
    return this.regras.regrasEmLinguagemSimples();
  }
}
