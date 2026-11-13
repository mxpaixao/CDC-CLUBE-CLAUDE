import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import 'multer';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AtorAtual, Equipe } from '../auth/decoradores';
import type { Ator } from '../comum/auditoria.service';
import { ErroNegocio } from '../comum/erros';
import { validar } from '../comum/zod';
import { ImportacoesService } from './importacoes.service';

const mapeamento = z.object({
  nome: z.string().min(3),
  colunas: z.record(z.string(), z.string()),
  formatoData: z.string().default('dd/MM/yyyy'),
  separadorDecimal: z.enum(['virgula', 'ponto']).default('virgula'),
  delimitadorCsv: z.string().min(1).max(1).default(';'),
  padrao: z.boolean().optional(),
});

@ApiTags('importacoes')
@Controller('importacoes')
export class ImportacoesController {
  constructor(private readonly importacoes: ImportacoesService) {}

  @Equipe('visualizacao_relatorios')
  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('arquivo', { limits: { fileSize: 30 * 1024 * 1024 } }))
  importar(
    @UploadedFile() arquivo: Express.Multer.File | undefined,
    @Body('mapeamentoId') mapeamentoId: string | undefined,
    @AtorAtual() ator: Ator,
  ) {
    if (!arquivo)
      throw new ErroNegocio('ARQUIVO_OBRIGATORIO', 'envie o arquivo no campo "arquivo"', 400);
    if (!/\.(csv|xlsx)$/i.test(arquivo.originalname))
      throw new ErroNegocio('FORMATO_INVALIDO', 'use arquivos .csv ou .xlsx', 400);
    return this.importacoes.importar(
      {
        nome: arquivo.originalname,
        conteudo: arquivo.buffer,
        mapeamentoId: mapeamentoId || null,
        origem: 'UPLOAD',
      },
      ator,
    );
  }

  @Equipe('visualizacao_relatorios')
  @Get()
  listar(@Query('pagina') pagina?: string) {
    return this.importacoes.listar(Math.max(1, Number(pagina ?? 1)));
  }

  @Equipe('visualizacao_relatorios')
  @Get('mapeamentos')
  mapeamentos() {
    return this.importacoes.listarMapeamentos();
  }

  @Equipe('admin')
  @Post('mapeamentos')
  criarMapeamento(
    @Body(validar(mapeamento)) c: z.infer<typeof mapeamento>,
    @AtorAtual() ator: Ator,
  ) {
    return this.importacoes.salvarMapeamento(c, ator);
  }

  @Equipe('admin')
  @Put('mapeamentos/:id')
  editarMapeamento(
    @Param('id') id: string,
    @Body(validar(mapeamento)) c: z.infer<typeof mapeamento>,
    @AtorAtual() ator: Ator,
  ) {
    return this.importacoes.salvarMapeamento({ ...c, id }, ator);
  }

  @Equipe('visualizacao_relatorios')
  @Get(':id')
  detalhe(@Param('id') id: string) {
    return this.importacoes.detalhe(id);
  }
}
