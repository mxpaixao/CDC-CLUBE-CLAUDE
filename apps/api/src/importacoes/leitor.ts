import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { DateTime } from 'luxon';
import { FUSO_CDC, type SeparadorDecimal, parseValorMonetario } from '@cdc/shared';
import type {
  DevolucaoImportada,
  ItemImportado,
  VendaImportada,
} from '../vendas/processamento.service';

export type Linha = Record<string, string>;

export interface Mapeamento {
  colunas: Record<string, string>;
  formatoData: string;
  separadorDecimal: SeparadorDecimal;
  delimitadorCsv: string;
}

/** Obrigatórias em qualquer arquivo; `sku` e `valor_bruto` são exigidos nas linhas de VENDA. */
export const CAMPOS_OBRIGATORIOS = ['loja', 'documento', 'data', 'item'] as const;

/** Lê CSV ou XLSX e devolve linhas como texto (cabeçalho → valor). */
export async function lerArquivo(
  nome: string,
  conteudo: Buffer,
  delimitador = ';',
): Promise<Linha[]> {
  if (/\.xlsx$/i.test(nome)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(conteudo as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const cab: string[] = [];
    ws.getRow(1).eachCell(
      { includeEmpty: true },
      (c, col) => (cab[col] = String(c.text ?? '').trim()),
    );
    const linhas: Linha[] = [];
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (n === 1) return;
      const l: Linha = {};
      row.eachCell({ includeEmpty: true }, (c, col) => {
        if (!cab[col]) return;
        const v = c.value;
        if (v instanceof Date)
          l[cab[col]] = DateTime.fromJSDate(v, { zone: 'utc' }).toFormat("yyyy-LL-dd'T'HH:mm:ss");
        else if (typeof v === 'number') l[cab[col]] = String(v);
        else l[cab[col]] = String(c.text ?? '').trim();
      });
      linhas.push(l);
    });
    return linhas;
  }
  const bruto = conteudo.toString('utf8');
  const texto = bruto.charCodeAt(0) === 0xfeff ? bruto.slice(1) : bruto; // remove BOM
  return parse(texto, {
    columns: (c: string[]) => c.map((x) => x.trim()),
    delimiter: delimitador,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Linha[];
}

function booleano(v: string | undefined): boolean {
  return /^(s|sim|1|true|x|y|yes)$/i.test((v ?? '').trim());
}

/** Datas do ERP são interpretadas no fuso de Manaus. Data sem hora → 12:00 local. */
export function lerData(v: string, formato: string): Date {
  const t = (v ?? '').trim();
  const tentativas = [
    formato,
    `${formato} HH:mm`,
    `${formato} HH:mm:ss`,
    "yyyy-LL-dd'T'HH:mm:ss",
    'yyyy-LL-dd HH:mm:ss',
    'yyyy-LL-dd',
  ];
  for (const f of tentativas) {
    const d = DateTime.fromFormat(t, f, { zone: FUSO_CDC });
    if (d.isValid) return (f.includes('HH') ? d : d.set({ hour: 12 })).toJSDate();
  }
  const iso = DateTime.fromISO(t, { zone: FUSO_CDC });
  if (iso.isValid) return iso.toJSDate();
  throw new Error(`data inválida: "${v}" (formato esperado ${formato})`);
}

function tipoItem(v: string | undefined): ItemImportado['tipo'] {
  const t = (v ?? '').trim().toUpperCase();
  if (t.startsWith('SERV')) return 'SERVICO';
  if (t.startsWith('FRET')) return 'FRETE';
  return 'MERCADORIA';
}

export interface ErroLinha {
  linha: number;
  documento?: string;
  erro: string;
}

export interface Agrupado {
  vendas: { linhas: number[]; venda: VendaImportada }[];
  devolucoes: { linhas: number[]; devolucao: DevolucaoImportada }[];
  erros: ErroLinha[];
}

/** Aplica o mapeamento de colunas e agrupa as linhas por documento. */
export function agrupar(linhas: Linha[], m: Mapeamento): Agrupado {
  const erros: ErroLinha[] = [];
  const campo = (l: Linha, nome: string) => {
    const col = m.colunas[nome];
    return col ? (l[col] ?? '').toString().trim() : '';
  };
  const faltando = CAMPOS_OBRIGATORIOS.filter(
    (c) => !m.colunas[c] || (linhas[0] && !(m.colunas[c] in linhas[0])),
  );
  if (linhas.length && faltando.length) {
    return {
      vendas: [],
      devolucoes: [],
      erros: [
        {
          linha: 1,
          erro: `colunas obrigatórias ausentes no arquivo: ${faltando.map((c) => m.colunas[c] ?? c).join(', ')}`,
        },
      ],
    };
  }
  const dinheiro = (v: string, nomeCampo: string, padrao?: number) => {
    if (!v) {
      if (padrao !== undefined) return padrao;
      throw new Error(`${nomeCampo} vazio`);
    }
    return parseValorMonetario(v, m.separadorDecimal);
  };

  type Grupo = { tipo: string; linhas: number[]; brutas: Linha[] };
  const grupos = new Map<string, Grupo>();
  linhas.forEach((l, i) => {
    const n = i + 2; // linha 1 = cabeçalho
    const tipo = (campo(l, 'tipo_movimento') || 'VENDA').toUpperCase();
    const loja = campo(l, 'loja');
    const doc = campo(l, 'documento');
    if (!loja || !doc) {
      erros.push({ linha: n, erro: 'loja e documento são obrigatórios' });
      return;
    }
    if (!['VENDA', 'DEVOLUCAO', 'CANCELAMENTO'].includes(tipo)) {
      erros.push({ linha: n, documento: doc, erro: `tipo_movimento inválido: ${tipo}` });
      return;
    }
    const chave = `${tipo}|${loja}|${doc}`;
    const g = grupos.get(chave) ?? { tipo, linhas: [], brutas: [] };
    g.linhas.push(n);
    g.brutas.push(l);
    grupos.set(chave, g);
  });

  const vendas: Agrupado['vendas'] = [];
  const devolucoes: Agrupado['devolucoes'] = [];
  for (const g of grupos.values()) {
    const p = g.brutas[0];
    const doc = campo(p, 'documento');
    try {
      const data = lerData(campo(p, 'data'), m.formatoData);
      if (g.tipo === 'VENDA') {
        const compradores = new Set(g.brutas.map((l) => campo(l, 'comprador_documento')));
        if (compradores.size > 1)
          throw new Error('comprador diferente entre itens do mesmo documento');
        const itens: ItemImportado[] = g.brutas.map((l, idx) => {
          if (!campo(l, 'sku')) throw new Error(`linha ${g.linhas[idx]}: sku vazio`);
          const bruto = dinheiro(campo(l, 'valor_bruto'), 'valor_bruto');
          const desconto = dinheiro(campo(l, 'desconto'), 'desconto', 0);
          const liquidoTxt = campo(l, 'valor_liquido');
          if (liquidoTxt && dinheiro(liquidoTxt, 'valor_liquido') !== bruto - desconto) {
            throw new Error(
              `linha ${g.linhas[idx]}: valor_liquido difere de valor_bruto − desconto`,
            );
          }
          if (bruto < 0 || desconto < 0 || desconto > bruto)
            throw new Error(
              `linha ${g.linhas[idx]}: valores negativos ou desconto maior que o valor`,
            );
          const custo = campo(l, 'custo');
          return {
            numeroItem: campo(l, 'item') || String(idx + 1),
            sku: campo(l, 'sku'),
            descricao: campo(l, 'descricao') || null,
            familia: campo(l, 'familia') || null,
            subfamilia: campo(l, 'subfamilia') || null,
            tipo: tipoItem(campo(l, 'tipo_item')),
            quantidade: (campo(l, 'quantidade') || '1').replace(
              m.separadorDecimal === 'virgula' ? ',' : '§',
              '.',
            ),
            valorBrutoCentavos: bruto,
            descontoCentavos: desconto,
            custoCentavos: custo ? dinheiro(custo, 'custo') : null,
            emPromocao: booleano(campo(l, 'em_promocao')),
            descontoNegociado: booleano(campo(l, 'desconto_negociado')),
          };
        });
        const itensUnicos = new Set(itens.map((i) => i.numeroItem));
        if (itensUnicos.size !== itens.length)
          throw new Error('número de item repetido no documento');
        const dataConf = campo(p, 'data_confirmacao');
        vendas.push({
          linhas: g.linhas,
          venda: {
            lojaCodigoErp: campo(p, 'loja'),
            documento: doc,
            canal: (campo(p, 'canal') || 'LOJA').toUpperCase(),
            dataVenda: data,
            dataConfirmacao: dataConf ? lerData(dataConf, m.formatoData) : data,
            compradorDocumento: campo(p, 'comprador_documento') || null,
            compradorNome: campo(p, 'comprador_nome') || null,
            compradorCpfAutorizado: campo(p, 'comprador_cpf_autorizado') || null,
            codigoIndicacao: campo(p, 'codigo_indicacao') || null,
            vendedor: campo(p, 'vendedor') || null,
            tabelaPreco: campo(p, 'tabela_preco') || null,
            freteCentavos: dinheiro(campo(p, 'frete'), 'frete', 0),
            pagoComCashbackCentavos: dinheiro(campo(p, 'pago_cashback'), 'pago_cashback', 0),
            codigoResgate: campo(p, 'codigo_resgate') || null,
            itens,
          },
        });
      } else {
        const origem = campo(p, 'documento_origem') || (g.tipo === 'CANCELAMENTO' ? doc : '');
        if (!origem) throw new Error('documento_origem é obrigatório em devoluções');
        devolucoes.push({
          linhas: g.linhas,
          devolucao: {
            lojaCodigoErp: campo(p, 'loja'),
            documentoVenda: origem,
            documentoDevolucao: g.tipo === 'CANCELAMENTO' && origem === doc ? `CANC-${doc}` : doc,
            tipo: g.tipo as 'DEVOLUCAO' | 'CANCELAMENTO',
            data,
            itens: g.brutas.map((l) => {
              const liquido = campo(l, 'valor_liquido');
              const bruto = campo(l, 'valor_bruto');
              const valor = liquido
                ? dinheiro(liquido, 'valor_liquido')
                : bruto
                  ? dinheiro(bruto, 'valor_bruto') - dinheiro(campo(l, 'desconto'), 'desconto', 0)
                  : null;
              return {
                numeroItem: campo(l, 'item'),
                quantidade: (campo(l, 'quantidade') || '0').replace(',', '.'),
                valorCentavos: valor,
              };
            }),
          },
        });
      }
    } catch (e) {
      for (const n of g.linhas)
        erros.push({ linha: n, documento: doc, erro: (e as Error).message });
    }
  }
  return { vendas, devolucoes, erros };
}

/** Quantidade decimal ("1,5" / "1.500") em milésimos inteiros — sem float. */
export function quantidadeEmMilesimos(q: string): bigint {
  const t = String(q ?? '')
    .trim()
    .replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return 0n;
  const [inteiro, fracao = ''] = t.split('.');
  return BigInt(inteiro) * 1000n + BigInt((fracao + '000').slice(0, 3));
}
