import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SeparadorDecimal } from '@cdc/shared';
import { AuditoriaService, SISTEMA, type Ator } from '../comum/auditoria.service';
import { config } from '../comum/config';
import { ErroNegocio, naoEncontrado } from '../comum/erros';
import { EstadoSistemaService } from '../comum/estado-sistema.service';
import { PrismaService } from '../comum/prisma.service';
import { Relogio } from '../comum/relogio';
import { ProcessamentoVendasService } from '../vendas/processamento.service';
import { ERP_GATEWAY, type ErpGateway } from '../erp/erp-gateway';
import type { ErroLinha } from './leitor';

@Injectable()
export class ImportacoesService {
  private readonly logger = new Logger('Importacoes');

  constructor(
    private readonly prisma: PrismaService,
    private readonly relogio: Relogio,
    private readonly processamento: ProcessamentoVendasService,
    private readonly auditoria: AuditoriaService,
    private readonly estado: EstadoSistemaService,
    @Inject(ERP_GATEWAY) private readonly erp: ErpGateway,
  ) {}

  async mapeamento(id?: string | null) {
    const m = id
      ? await this.prisma.mapeamentoImportacao.findUnique({ where: { id } })
      : await this.prisma.mapeamentoImportacao.findFirst({ where: { padrao: true } });
    if (!m) throw naoEncontrado('mapeamento de importação');
    return m;
  }

  /**
   * Importa um arquivo exportado do ERP. Cada documento é processado de forma independente e
   * idempotente (loja + documento + item): reimportar o mesmo arquivo não duplica nada.
   */
  async importar(
    entrada: {
      nome: string;
      conteudo: Buffer;
      mapeamentoId?: string | null;
      origem: 'UPLOAD' | 'PASTA';
    },
    ator: Ator,
  ) {
    const hash = createHash('sha256').update(entrada.conteudo).digest('hex');
    const anterior = await this.prisma.importacao.findFirst({
      where: { arquivoHash: hash, status: { in: ['CONCLUIDA', 'CONCLUIDA_COM_ERROS'] } },
    });
    const m = await this.mapeamento(entrada.mapeamentoId);
    const importacao = await this.prisma.importacao.create({
      data: {
        arquivoNome: entrada.nome,
        arquivoHash: hash,
        origem: entrada.origem,
        mapeamentoId: m.id,
        usuarioId: ator.id,
      },
    });
    try {
      const grupos = (await this.erp.obterMovimentos({
        tipo: 'ARQUIVO',
        nome: entrada.nome,
        conteudo: entrada.conteudo,
        mapeamento: {
          colunas: m.colunas as Record<string, string>,
          formatoData: m.formatoData,
          separadorDecimal: m.separadorDecimal as SeparadorDecimal,
          delimitadorCsv: m.delimitadorCsv,
        },
      })) as Awaited<ReturnType<ErpGateway['obterMovimentos']>> & { totalLinhas: number };
      const erros: ErroLinha[] = [...grupos.erros];
      let ok = 0;
      let ignoradas = 0;
      const resumo = {
        vendasNovas: 0,
        vendasRepetidas: 0,
        devolucoes: 0,
        cashbackCentavos: 0,
        recompensaCentavos: 0,
        avisos: {} as Record<string, number>,
      };
      for (const g of grupos.vendas) {
        try {
          const r = await this.processamento.processarVenda(g.venda, importacao.id, ator);
          if (r.repetida) {
            ignoradas += g.linhas.length;
            resumo.vendasRepetidas++;
          } else {
            ok += g.linhas.length;
            resumo.vendasNovas++;
            resumo.cashbackCentavos += r.cashbackCentavos;
            resumo.recompensaCentavos += r.recompensaCentavos;
          }
          for (const a of r.avisos) resumo.avisos[a] = (resumo.avisos[a] ?? 0) + 1;
        } catch (e) {
          for (const n of g.linhas)
            erros.push({ linha: n, documento: g.venda.documento, erro: (e as Error).message });
        }
      }
      for (const g of grupos.devolucoes) {
        try {
          const r = await this.processamento.processarDevolucao(g.devolucao, importacao.id, ator);
          if (r.repetida) ignoradas += g.linhas.length;
          else {
            ok += g.linhas.length;
            resumo.devolucoes++;
          }
        } catch (e) {
          for (const n of g.linhas)
            erros.push({
              linha: n,
              documento: g.devolucao.documentoDevolucao,
              erro: (e as Error).message,
            });
        }
      }
      const linhasErro = new Set(erros.map((e) => e.linha)).size;
      const final = await this.prisma.importacao.update({
        where: { id: importacao.id },
        data: {
          status: linhasErro ? 'CONCLUIDA_COM_ERROS' : 'CONCLUIDA',
          linhasTotal: grupos.totalLinhas,
          linhasOk: ok,
          linhasIgnoradas: ignoradas,
          linhasErro,
          erros: erros.slice(0, 500) as unknown as Prisma.InputJsonValue,
          resumo: {
            ...resumo,
            arquivoJaImportadoEm: anterior?.iniciadaEm ?? null,
          } as unknown as Prisma.InputJsonValue,
          concluidaEm: this.relogio.agora(),
        },
      });
      await this.estado.definir('ultima_importacao_ok', {
        em: this.relogio.agora().toISOString(),
        importacaoId: importacao.id,
      });
      await this.auditoria.registrar(ator, 'IMPORTACAO', 'Importacao', importacao.id, {
        depois: { arquivo: entrada.nome, ok, ignoradas, linhasErro },
      });
      return final;
    } catch (e) {
      this.logger.error(`importação ${importacao.id} falhou: ${(e as Error).message}`);
      return this.prisma.importacao.update({
        where: { id: importacao.id },
        data: {
          status: 'FALHOU',
          erros: [{ linha: 0, erro: (e as Error).message }] as unknown as Prisma.InputJsonValue,
          concluidaEm: this.relogio.agora(),
        },
      });
    }
  }

  /** Job: processa arquivos da pasta monitorada (entrada → processados | erros). */
  async processarPastaMonitorada() {
    const base = path.resolve(config.pastaImportacao);
    const entrada = path.join(base, 'entrada');
    await fs.mkdir(entrada, { recursive: true });
    await fs.mkdir(path.join(base, 'processados'), { recursive: true });
    await fs.mkdir(path.join(base, 'erros'), { recursive: true });
    const arquivos = (await fs.readdir(entrada)).filter((f) => /\.(csv|xlsx)$/i.test(f)).sort();
    const resultados = [];
    for (const nome of arquivos) {
      const origem = path.join(entrada, nome);
      const conteudo = await fs.readFile(origem);
      const r = await this.importar({ nome, conteudo, origem: 'PASTA' }, SISTEMA);
      const destino = r.status === 'FALHOU' ? 'erros' : 'processados';
      await fs.rename(
        origem,
        path.join(
          base,
          destino,
          `${this.relogio.agora().toISOString().replace(/[:.]/g, '-')}_${nome}`,
        ),
      );
      if (r.status === 'FALHOU') {
        // integração automática falhou: novas liberações e resgates aguardam confirmação
        await this.estado.definirContingencia(
          true,
          `falha na importação automática do arquivo ${nome}`,
          SISTEMA,
        );
      }
      resultados.push({ arquivo: nome, status: r.status });
    }
    return resultados;
  }

  listar(pagina = 1) {
    return this.prisma.importacao.findMany({
      orderBy: { iniciadaEm: 'desc' },
      skip: (pagina - 1) * 50,
      take: 50,
    });
  }

  async detalhe(id: string) {
    const i = await this.prisma.importacao.findUnique({ where: { id } });
    if (!i) throw naoEncontrado('importação');
    return i;
  }

  listarMapeamentos() {
    return this.prisma.mapeamentoImportacao.findMany({ orderBy: { nome: 'asc' } });
  }

  async salvarMapeamento(
    d: {
      id?: string;
      nome: string;
      colunas: Record<string, string>;
      formatoData: string;
      separadorDecimal: 'virgula' | 'ponto';
      delimitadorCsv: string;
      padrao?: boolean;
    },
    ator: Ator,
  ) {
    if (!d.colunas.documento || !d.colunas.loja || !d.colunas.sku)
      throw new ErroNegocio(
        'MAPEAMENTO_INVALIDO',
        'mapeie ao menos loja, documento, item, sku, data e valor_bruto',
        400,
      );
    const r = await this.prisma.$transaction(async (tx) => {
      if (d.padrao) await tx.mapeamentoImportacao.updateMany({ data: { padrao: false } });
      const dados = {
        nome: d.nome,
        colunas: d.colunas,
        formatoData: d.formatoData,
        separadorDecimal: d.separadorDecimal,
        delimitadorCsv: d.delimitadorCsv,
        padrao: !!d.padrao,
      };
      return d.id
        ? tx.mapeamentoImportacao.update({ where: { id: d.id }, data: dados })
        : tx.mapeamentoImportacao.create({ data: dados });
    });
    await this.auditoria.registrar(ator, 'MAPEAMENTO_SALVO', 'MapeamentoImportacao', r.id, {
      depois: d,
    });
    return r;
  }
}
