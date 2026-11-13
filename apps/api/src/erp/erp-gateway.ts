import { NotImplementedException } from '@nestjs/common';
import { type Agrupado, type Mapeamento, agrupar, lerArquivo } from '../importacoes/leitor';

/**
 * Porta de integração com o ERP (GIX/SHX). O Clube NUNCA escreve nas tabelas do ERP:
 * apenas lê movimentos (vendas, itens, pagamentos, devoluções, cancelamentos).
 */
export type EntradaErp =
  | { tipo: 'ARQUIVO'; nome: string; conteudo: Buffer; mapeamento: Mapeamento }
  | { tipo: 'API'; desde: Date; ate: Date };

export interface ErpGateway {
  readonly nome: string;
  obterMovimentos(entrada: EntradaErp): Promise<Agrupado>;
}

/** Fase 1: arquivos CSV/XLSX exportados do ERP (upload no painel ou pasta monitorada). */
export class ImportacaoArquivoAdapter implements ErpGateway {
  readonly nome = 'arquivo';

  async obterMovimentos(entrada: EntradaErp): Promise<Agrupado> {
    if (entrada.tipo !== 'ARQUIVO') throw new Error('ImportacaoArquivoAdapter só aceita arquivos');
    const linhas = await lerArquivo(
      entrada.nome,
      entrada.conteudo,
      entrada.mapeamento.delimitadorCsv,
    );
    const agrupado = agrupar(linhas, entrada.mapeamento);
    return { ...agrupado, totalLinhas: linhas.length } as Agrupado & { totalLinhas: number };
  }
}

/** Integração em tempo real com a SHX — interface pronta, implementação quando a API for liberada. */
export class ShxApiAdapter implements ErpGateway {
  readonly nome = 'shx-api';

  async obterMovimentos(_entrada: EntradaErp): Promise<Agrupado> {
    throw new NotImplementedException(
      'integração via API da SHX ainda não disponível (Fase 1 usa importação de arquivo)',
    );
  }
}

export const ERP_GATEWAY = Symbol('ERP_GATEWAY');
