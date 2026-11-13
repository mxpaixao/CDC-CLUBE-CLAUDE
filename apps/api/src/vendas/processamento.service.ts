import { Injectable, Logger } from '@nestjs/common';
import { type PerfilComercial, Prisma, type TipoItem } from '@prisma/client';
import {
  type ResultadoCalculo,
  aplicarTetoMensal,
  avaliarPisosMargem,
  calcularVenda,
  recalcularAposDevolucao,
  verificarAutoindicacao,
} from '@cdc/rules';
import {
  calcularLiberaEm,
  calcularVenceEm,
  identificarDocumento,
  intervaloMesCivil,
  normalizarCodigoPrestador,
  normalizarCodigoResgate,
  normalizarCpf,
  somarDias,
} from '@cdc/shared';
import { AuditoriaService, SISTEMA, type Ator } from '../comum/auditoria.service';
import { ErroNegocio } from '../comum/erros';
import { EstadoSistemaService } from '../comum/estado-sistema.service';
import { paraJson } from '../comum/json';
import { PrismaService, type Tx } from '../comum/prisma.service';
import { Relogio } from '../comum/relogio';
import { LivroRazaoService, chaveTitular } from '../carteiras/livro-razao.service';
import { NotificacoesService } from '../notificacoes/notificacoes.service';
import { RegrasService } from '../regras/regras.service';
import { AlertasService } from './alertas.service';
import { quantidadeEmMilesimos } from '../importacoes/leitor';

export interface ItemImportado {
  numeroItem: string;
  sku: string;
  descricao?: string | null;
  familia?: string | null;
  subfamilia?: string | null;
  tipo: TipoItem;
  quantidade: string;
  valorBrutoCentavos: number;
  descontoCentavos: number;
  custoCentavos?: number | null;
  emPromocao?: boolean;
  descontoNegociado?: boolean;
}

export interface VendaImportada {
  lojaCodigoErp: string;
  documento: string;
  canal: string;
  dataVenda: Date;
  dataConfirmacao: Date;
  compradorDocumento?: string | null;
  compradorNome?: string | null;
  compradorCpfAutorizado?: string | null;
  codigoIndicacao?: string | null;
  vendedor?: string | null;
  tabelaPreco?: string | null;
  freteCentavos: number;
  pagoComCashbackCentavos: number;
  codigoResgate?: string | null;
  itens: ItemImportado[];
}

export interface DevolucaoImportada {
  lojaCodigoErp: string;
  documentoVenda: string;
  documentoDevolucao: string;
  tipo: 'DEVOLUCAO' | 'CANCELAMENTO';
  data: Date;
  itens: { numeroItem: string; quantidade: string; valorCentavos?: number | null }[];
}

export interface ResultadoProcessamento {
  vendaId: string;
  repetida: boolean;
  cashbackCentavos: number;
  recompensaCentavos: number;
  avisos: string[];
}

interface Comprador {
  chave: string | null;
  pessoaId: string | null;
  empresaId: string | null;
  participanteAtivo: boolean;
  participanteId: string | null;
  dataAdesao: Date | null;
  boasVindasDisponivel: boolean;
  cpfs: string[];
  cnpj: string | null;
  telefones: string[];
  prestadorProprio: { id: string; status: string } | null;
}

@Injectable()
export class ProcessamentoVendasService {
  private readonly logger = new Logger('ProcessamentoVendas');

  constructor(
    private readonly prisma: PrismaService,
    private readonly relogio: Relogio,
    private readonly regras: RegrasService,
    private readonly livro: LivroRazaoService,
    private readonly auditoria: AuditoriaService,
    private readonly estado: EstadoSistemaService,
    private readonly alertas: AlertasService,
    private readonly notificacoes: NotificacoesService,
  ) {}

  // ───────────────────────────────────────────── identificação

  private async identificarComprador(tx: Tx, v: VendaImportada): Promise<Comprador> {
    const vazio: Comprador = {
      chave: null,
      pessoaId: null,
      empresaId: null,
      participanteAtivo: false,
      participanteId: null,
      dataAdesao: null,
      boasVindasDisponivel: false,
      cpfs: [],
      cnpj: null,
      telefones: [],
      prestadorProprio: null,
    };
    const doc = v.compradorDocumento ? identificarDocumento(v.compradorDocumento) : null;
    if (!doc) return vazio;
    if (doc.tipo === 'CPF') {
      const pessoa = await tx.pessoa.findUnique({
        where: { cpf: doc.valor },
        include: { participante: true, prestador: true },
      });
      if (!pessoa) return { ...vazio, cpfs: [doc.valor] };
      const p = pessoa.participante;
      const ativo =
        !!p && p.status === 'ATIVO' && p.dataAdesao.getTime() <= v.dataConfirmacao.getTime();
      return {
        chave: chaveTitular({ pessoaId: pessoa.id }),
        pessoaId: pessoa.id,
        empresaId: null,
        participanteAtivo: ativo,
        participanteId: p?.id ?? null,
        dataAdesao: p?.dataAdesao ?? null,
        boasVindasDisponivel: ativo && !p!.boasVindasVendaId,
        cpfs: [pessoa.cpf],
        cnpj: null,
        telefones: pessoa.telefone ? [pessoa.telefone] : [],
        prestadorProprio: pessoa.prestador
          ? { id: pessoa.prestador.id, status: pessoa.prestador.status }
          : null,
      };
    }
    const empresa = await tx.empresa.findUnique({
      where: { cnpj: doc.valor },
      include: { participante: true, compradores: { include: { pessoa: true } } },
    });
    const prestadorMei = await tx.prestador.findFirst({ where: { cnpj: doc.valor } });
    if (!empresa)
      return {
        ...vazio,
        cnpj: doc.valor,
        prestadorProprio: prestadorMei
          ? { id: prestadorMei.id, status: prestadorMei.status }
          : null,
      };
    const p = empresa.participante;
    const ativo =
      !!p && p.status === 'ATIVO' && p.dataAdesao.getTime() <= v.dataConfirmacao.getTime();
    return {
      chave: chaveTitular({ empresaId: empresa.id }),
      pessoaId: null,
      empresaId: empresa.id,
      participanteAtivo: ativo,
      participanteId: p?.id ?? null,
      dataAdesao: p?.dataAdesao ?? null,
      boasVindasDisponivel: ativo && !p!.boasVindasVendaId,
      cpfs: empresa.compradores
        .map((c) => c.pessoa.cpf)
        .concat(v.compradorCpfAutorizado ? [normalizarCpf(v.compradorCpfAutorizado)] : []),
      cnpj: empresa.cnpj,
      telefones: [empresa.telefone, ...empresa.compradores.map((c) => c.pessoa.telefone)].filter(
        (t): t is string => !!t,
      ),
      prestadorProprio: prestadorMei ? { id: prestadorMei.id, status: prestadorMei.status } : null,
    };
  }

  /** Código na venda > pré-registro no caixa > vínculo ativo mais recente (D-021). */
  private async identificarIndicador(
    tx: Tx,
    v: VendaImportada,
    lojaId: string,
    comprador: Comprador,
  ) {
    if (v.codigoIndicacao?.trim()) {
      const codigo = normalizarCodigoPrestador(v.codigoIndicacao);
      const prestador = await tx.prestador.findUnique({
        where: { codigo },
        include: { pessoa: true },
      });
      return { prestador, origem: 'CODIGO_NA_VENDA', codigoInformado: codigo };
    }
    const pre = await tx.indicacaoPreRegistro.findUnique({
      where: { lojaId_documentoErp: { lojaId, documentoErp: v.documento } },
    });
    if (pre) {
      const prestador = await tx.prestador.findUnique({
        where: { id: pre.prestadorId },
        include: { pessoa: true },
      });
      await tx.indicacaoPreRegistro.update({
        where: { id: pre.id },
        data: { utilizadoEm: this.relogio.agora() },
      });
      return { prestador, origem: 'PRE_REGISTRO', codigoInformado: prestador?.codigo ?? null };
    }
    if (comprador.chave) {
      const vinculo = await tx.vinculoIndicacao.findFirst({
        where: {
          compradorChave: comprador.chave,
          inicio: { lte: v.dataConfirmacao },
          fim: { gt: v.dataConfirmacao },
        },
        orderBy: { inicio: 'desc' },
        include: { prestador: { include: { pessoa: true } } },
      });
      if (vinculo)
        return { prestador: vinculo.prestador, origem: 'VINCULO', codigoInformado: null };
    }
    return { prestador: null, origem: null, codigoInformado: null };
  }

  // ───────────────────────────────────────────── venda

  async processarVenda(
    v: VendaImportada,
    importacaoId: string | null,
    ator: Ator = SISTEMA,
  ): Promise<ResultadoProcessamento> {
    const loja = await this.prisma.loja.findUnique({ where: { codigoErp: v.lojaCodigoErp } });
    if (!loja)
      throw new ErroNegocio('LOJA_DESCONHECIDA', `loja ${v.lojaCodigoErp} não cadastrada`, 422);
    const chave = `${loja.id}:${v.documento}`;
    const existente = await this.prisma.venda.findUnique({ where: { chaveIdempotencia: chave } });
    if (existente) {
      return {
        vendaId: existente.id,
        repetida: true,
        cashbackCentavos: existente.cashbackCentavos,
        recompensaCentavos: existente.recompensaCentavos,
        avisos: [],
      };
    }
    const avisos: string[] = [];
    const contingencia = await this.estado.contingencia();

    const r = await this.prisma.transacao(async (tx) => {
      const repetida = await tx.venda.findUnique({ where: { chaveIdempotencia: chave } });
      if (repetida) return { venda: repetida, repetida: true as const };
      const config = await this.regras.configuracaoEm(v.dataConfirmacao, tx);
      const prog = config.programa.parametros;
      const comprador = await this.identificarComprador(tx, v);
      const tabelaProfissional =
        !!v.tabelaPreco && prog.tabelasPrecoProfissionais.includes(v.tabelaPreco);

      // perfil comercial único da venda (D-017)
      let perfil: PerfilComercial =
        comprador.empresaId || (comprador.cnpj && !comprador.pessoaId)
          ? 'CLIENTE_EMPRESA'
          : 'CLIENTE_CPF';
      if (tabelaProfissional) {
        if (comprador.prestadorProprio?.status === 'APROVADO') perfil = 'PRESTADOR';
        else avisos.push('TABELA_PROFISSIONAL_SEM_PRESTADOR');
      }

      // indicação
      const ind = await this.identificarIndicador(tx, v, loja.id, comprador);
      let indicacao: { nivel: 'BRONZE' | 'PRATA' | 'OURO'; bloqueio: string | null } | null = null;
      const prestador = ind.prestador;
      if (prestador) {
        if (prestador.status !== 'APROVADO') {
          avisos.push(`INDICADOR_${prestador.status}`);
        } else {
          const af = verificarAutoindicacao({
            comprador: {
              cpfs: comprador.cpfs,
              cnpj: comprador.cnpj,
              telefones: comprador.telefones,
            },
            prestador: {
              cpfTitular: prestador.pessoa.cpf,
              cnpj: prestador.cnpj,
              telefones: [prestador.pessoa.telefone, prestador.whatsapp].filter(
                (t): t is string => !!t,
              ),
            },
          });
          indicacao = {
            nivel: prestador.nivel,
            bloqueio: af.bloqueada ? `AUTOINDICACAO:${af.motivos.join(',')}` : null,
          };
        }
      } else if (ind.codigoInformado) {
        avisos.push('CODIGO_INDICACAO_DESCONHECIDO');
      }

      const resultado = calcularVenda(
        {
          lojaId: loja.id,
          canal: v.canal,
          instante: v.dataConfirmacao,
          perfil,
          itens: v.itens.map((i) => ({
            id: i.numeroItem,
            sku: i.sku,
            familia: i.familia ?? null,
            subfamilia: i.subfamilia ?? null,
            tipo: i.tipo,
            valorBrutoCentavos: i.valorBrutoCentavos,
            descontoCentavos: i.descontoCentavos,
            custoCentavos: i.custoCentavos ?? null,
            emPromocao: !!i.emPromocao,
            descontoNegociado: !!i.descontoNegociado,
            tabelaProfissional,
          })),
          pagoComCashbackCentavos: v.pagoComCashbackCentavos,
          compradorParticipante: comprador.participanteAtivo,
          boasVindas: comprador.boasVindasDisponivel,
          indicacao: indicacao && prestador?.status === 'APROVADO' ? indicacao : null,
        },
        config,
      );

      // teto mensal do prestador (trava a carteira do prestador para serializar o acumulado do mês)
      let recompensa = resultado.indicacao.valorCentavos;
      let excedente = 0;
      let carteiraPrestadorId: string | null = null;
      if (prestador && recompensa > 0) {
        const cp = await this.livro.obterOuCriarCarteira(tx, 'PRESTADOR', {
          pessoaId: prestador.pessoaId,
        });
        carteiraPrestadorId = cp.id;
        await this.livro.travar(tx, cp.id);
        const mes = intervaloMesCivil(v.dataConfirmacao);
        const acumulado = await tx.venda.aggregate({
          where: {
            prestadorIndicadorId: prestador.id,
            dataConfirmacao: { gte: mes.inicio, lt: mes.fim },
          },
          _sum: { recompensaCentavos: true },
        });
        const teto = aplicarTetoMensal({
          valorCalculadoCentavos: recompensa,
          jaConcedidoNoMesCentavos: acumulado._sum.recompensaCentavos ?? 0,
          tetoMensalCentavos: prog.indicacao.tetoMensalCentavos,
        });
        recompensa = teto.concedidoCentavos;
        excedente = teto.excedenteCentavos;
      }

      const totalBruto = v.itens.reduce((a, i) => a + i.valorBrutoCentavos, 0);
      const totalDesc = v.itens.reduce((a, i) => a + i.descontoCentavos, 0);
      const servicos = v.itens
        .filter((i) => i.tipo === 'SERVICO')
        .reduce((a, i) => a + i.valorBrutoCentavos - i.descontoCentavos, 0);
      const freteItens = v.itens
        .filter((i) => i.tipo === 'FRETE')
        .reduce((a, i) => a + i.valorBrutoCentavos - i.descontoCentavos, 0);
      const cashback = resultado.cashback.valorCentavos;

      const venda = await tx.venda.create({
        data: {
          lojaId: loja.id,
          canal: v.canal,
          documentoErp: v.documento,
          chaveIdempotencia: chave,
          compradorDocumento: v.compradorDocumento
            ? (identificarDocumento(v.compradorDocumento)?.valor ?? v.compradorDocumento)
            : null,
          compradorPessoaId: comprador.pessoaId,
          compradorEmpresaId: comprador.empresaId,
          compradorAutorizadoCpf: v.compradorCpfAutorizado
            ? normalizarCpf(v.compradorCpfAutorizado)
            : null,
          prestadorIndicadorId: prestador?.status === 'APROVADO' ? prestador.id : null,
          codigoIndicacaoInformado: ind.codigoInformado,
          origemIndicacao: prestador?.status === 'APROVADO' ? ind.origem : null,
          vendedorCdc: v.vendedor ?? null,
          perfilAplicado: perfil,
          dataVenda: v.dataVenda,
          dataConfirmacao: v.dataConfirmacao,
          tabelaPreco: v.tabelaPreco ?? null,
          totalBrutoCentavos: totalBruto,
          totalDescontosCentavos: totalDesc,
          freteCentavos: v.freteCentavos + freteItens,
          servicosCentavos: servicos,
          pagoComCashbackCentavos: v.pagoComCashbackCentavos,
          codigoResgate: v.codigoResgate ? normalizarCodigoResgate(v.codigoResgate) : null,
          baseCalculoCentavos: resultado.baseCalculoCentavos,
          cashbackCentavos: cashback,
          recompensaCalculadaCentavos: resultado.indicacao.valorCentavos,
          recompensaCentavos: recompensa,
          recompensaExcedenteCentavos: excedente,
          regraVersaoId: resultado.regraVersaoPerfilId,
          calculo: paraJson(resultado) as Prisma.InputJsonValue,
          importacaoId,
          situacaoCredito: contingencia.ativa ? 'AGUARDANDO_CONFIRMACAO' : 'PROCESSADA',
          itens: {
            create: v.itens.map((i) => ({
              numeroItem: i.numeroItem,
              sku: i.sku,
              descricao: i.descricao ?? null,
              familiaCodigo: i.familia ?? null,
              subfamiliaCodigo: i.subfamilia ?? null,
              tipo: i.tipo,
              quantidade: new Prisma.Decimal(i.quantidade || '1'),
              valorBrutoCentavos: i.valorBrutoCentavos,
              descontoCentavos: i.descontoCentavos,
              valorLiquidoCentavos: i.valorBrutoCentavos - i.descontoCentavos,
              custoCentavos: i.custoCentavos ?? null,
              emPromocao: !!i.emPromocao,
              descontoNegociado: !!i.descontoNegociado,
              tabelaProfissional,
              chaveIdempotencia: `${chave}:${i.numeroItem}`,
            })),
          },
          pagamentos:
            v.pagoComCashbackCentavos > 0
              ? {
                  create: [
                    {
                      forma: 'CASHBACK_CDC',
                      valorCentavos: v.pagoComCashbackCentavos,
                      codigoResgate: v.codigoResgate ?? null,
                    },
                  ],
                }
              : undefined,
        },
      });

      // crédito do comprador
      if (cashback > 0 && comprador.participanteAtivo) {
        const carteira = await this.livro.obterOuCriarCarteira(tx, 'CLIENTE', {
          pessoaId: comprador.pessoaId,
          empresaId: comprador.empresaId,
        });
        const pc = prog.carteiras.CLIENTE;
        await this.livro.criarLote(tx, {
          carteiraId: carteira.id,
          tipo: 'CREDITO',
          origem: resultado.cashback.origem,
          valorCentavos: cashback,
          estado: 'PENDENTE',
          liberaEm: calcularLiberaEm(v.dataConfirmacao, pc.carenciaDias),
          vendaId: venda.id,
          regraVersaoId: resultado.regraVersaoPerfilId,
          chave: `cashback:${chave}`,
          criadoPor: ator.id ?? 'SISTEMA',
          detalhes: {
            validadeDias: pc.validadeDias,
            regrasUtilizadas: resultado.regrasUtilizadas,
            documento: v.documento,
            loja: loja.id,
          },
        });
        if (resultado.cashback.boasVindasAplicada && comprador.participanteId) {
          await tx.participante.update({
            where: { id: comprador.participanteId },
            data: { boasVindasVendaId: venda.id },
          });
        }
      }
      if (comprador.participanteId) {
        await tx.participante.update({
          where: { id: comprador.participanteId },
          data: { ultimaCompraEm: v.dataConfirmacao },
        });
      }

      // recompensa do prestador
      if (prestador && carteiraPrestadorId && recompensa > 0) {
        const pp = prog.carteiras.PRESTADOR;
        await this.livro.criarLote(tx, {
          carteiraId: carteiraPrestadorId,
          tipo: 'CREDITO',
          origem: 'INDICACAO',
          valorCentavos: recompensa,
          estado: 'PENDENTE',
          liberaEm: calcularLiberaEm(v.dataConfirmacao, pp.carenciaDias),
          vendaId: venda.id,
          regraVersaoId: resultado.regraVersaoProgramaId,
          chave: `indicacao:${chave}`,
          criadoPor: ator.id ?? 'SISTEMA',
          detalhes: {
            validadeDias: pp.validadeDias,
            nivel: indicacao?.nivel,
            documento: v.documento,
            loja: loja.id,
            excedenteTetoCentavos: excedente,
          },
        });
      }
      // vínculo de 90 dias a partir da 1ª compra indicada daquele comprador com aquele prestador
      if (
        prestador?.status === 'APROVADO' &&
        comprador.chave &&
        ind.origem !== 'VINCULO' &&
        !indicacao?.bloqueio
      ) {
        const ativo = await tx.vinculoIndicacao.findFirst({
          where: {
            compradorChave: comprador.chave,
            prestadorId: prestador.id,
            fim: { gt: v.dataConfirmacao },
          },
        });
        if (!ativo) {
          await tx.vinculoIndicacao.create({
            data: {
              compradorChave: comprador.chave,
              prestadorId: prestador.id,
              inicio: v.dataConfirmacao,
              fim: somarDias(v.dataConfirmacao, prog.indicacao.vinculoDias),
              origem: 'PRIMEIRA_COMPRA',
              vendaOrigemId: venda.id,
            },
          });
        }
      }

      // alertas (antifraude, teto, margem, tabela profissional)
      if (indicacao?.bloqueio) {
        await this.alertas.abrir(tx, {
          tipo: 'AUTOINDICACAO',
          severidade: 'ALTA',
          descricao: `autoindicação bloqueada (${indicacao.bloqueio}) na venda ${v.documento}`,
          referencia: venda.id,
          chave: `autoindicacao:${venda.id}`,
          dados: { prestadorId: prestador?.id },
        });
      }
      if (excedente > 0) {
        await this.alertas.abrir(tx, {
          tipo: 'TETO_MENSAL',
          severidade: 'BAIXA',
          descricao: `teto mensal do prestador ${prestador?.codigo}: R$ ${(excedente / 100).toFixed(2)} não gerados`,
          referencia: venda.id,
          chave: `teto:${venda.id}`,
          dados: { prestadorId: prestador?.id, excedenteCentavos: excedente },
        });
      }
      if (avisos.includes('TABELA_PROFISSIONAL_SEM_PRESTADOR')) {
        await this.alertas.abrir(tx, {
          tipo: 'TABELA_PROFISSIONAL_SEM_PRESTADOR',
          severidade: 'MEDIA',
          descricao: `venda ${v.documento} com tabela profissional para comprador que não é prestador aprovado`,
          referencia: venda.id,
          chave: `tabela:${venda.id}`,
        });
      }
      for (const a of avaliarPisosMargem(resultado, config, recompensa)) {
        await this.alertas.abrir(tx, {
          tipo: 'PISO_MARGEM',
          severidade: 'MEDIA',
          descricao: `venda ${v.documento}: família ${a.familia} ${a.motivo === 'MARGEM_ABAIXO_DO_PISO' ? 'abaixo da margem mínima' : 'com concessões acima do piso'}`,
          referencia: venda.id,
          chave: `margem:${venda.id}:${a.familia}`,
          dados: a as unknown as Record<string, unknown>,
        });
      }
      await this.upsertCatalogo(tx, v.itens);
      return {
        venda,
        repetida: false as const,
        prestadorPessoaId: prestador?.pessoaId ?? null,
        recompensa,
        carencia: prog.carteiras.PRESTADOR.carenciaDias,
      };
    });

    if (!r.repetida) {
      await this.conciliarResgateDaVenda(r.venda.id, ator, avisos);
      if ('prestadorPessoaId' in r && r.prestadorPessoaId && r.recompensa > 0) {
        await this.notificacoes
          .agendar({
            pessoaId: r.prestadorPessoaId,
            template: 'PRESTADOR_VENDA_CONFIRMADA',
            dados: {
              valor: (r.recompensa / 100).toFixed(2).replace('.', ','),
              carencia: r.carencia,
            },
            chave: `prest-venda:${r.venda.id}`,
          })
          .catch(() => null);
      }
    }
    return {
      vendaId: r.venda.id,
      repetida: r.repetida,
      cashbackCentavos: r.venda.cashbackCentavos,
      recompensaCentavos: r.venda.recompensaCentavos,
      avisos,
    };
  }

  private async upsertCatalogo(tx: Tx, itens: ItemImportado[]) {
    for (const i of itens) {
      if (i.tipo !== 'MERCADORIA') continue;
      if (i.familia)
        await tx.familia.upsert({
          where: { codigo: i.familia },
          create: { codigo: i.familia, nome: i.familia },
          update: {},
        });
      if (i.familia && i.subfamilia) {
        await tx.subfamilia.upsert({
          where: { codigo: i.subfamilia },
          create: { codigo: i.subfamilia, nome: i.subfamilia, familiaCodigo: i.familia },
          update: {},
        });
      }
      await tx.produto.upsert({
        where: { sku: i.sku },
        create: {
          sku: i.sku,
          descricao: i.descricao ?? i.sku,
          familiaCodigo: i.familia ?? null,
          subfamiliaCodigo: i.subfamilia ?? null,
        },
        update: {
          descricao: i.descricao ?? undefined,
          familiaCodigo: i.familia ?? undefined,
          subfamiliaCodigo: i.subfamilia ?? undefined,
        },
      });
    }
  }

  /** Concilia o código de resgate informado no ERP com a reserva do caixa. */
  async conciliarResgateDaVenda(vendaId: string, ator: Ator, avisos: string[] = []) {
    const venda = await this.prisma.venda.findUniqueOrThrow({ where: { id: vendaId } });
    const ref = `${venda.lojaId}/${venda.documentoErp}`;
    if (!venda.codigoResgate) {
      if (venda.pagoComCashbackCentavos > 0) {
        await this.alertas.divergencia({
          tipo: 'PAGAMENTO_CASHBACK_SEM_CODIGO',
          severidade: 'ALTA',
          descricao: `venda ${ref} tem R$ ${(venda.pagoComCashbackCentavos / 100).toFixed(2)} pagos com cashback sem código de resgate`,
          referencia: vendaId,
          chave: `semcodigo:${vendaId}`,
        });
      }
      return;
    }
    const reserva = await this.prisma.reserva.findUnique({
      where: { codigo: venda.codigoResgate },
    });
    if (!reserva) {
      await this.alertas.divergencia({
        tipo: 'CODIGO_RESGATE_DESCONHECIDO',
        severidade: 'ALTA',
        descricao: `venda ${ref} cita o código ${venda.codigoResgate}, que não existe`,
        referencia: vendaId,
        chave: `codigodesconhecido:${vendaId}`,
      });
      return;
    }
    let atual = reserva;
    if (reserva.status === 'ATIVA' && reserva.expiraEm > this.relogio.agora()) {
      atual = await this.livro.confirmarReserva(reserva.id, ref, ator);
      avisos.push('RESERVA_CONFIRMADA_PELA_IMPORTACAO');
    }
    if (atual.status !== 'CONFIRMADA' && atual.status !== 'ATIVA') {
      await this.alertas.divergencia({
        tipo: 'RESGATE_SEM_RESERVA_VALIDA',
        severidade: 'ALTA',
        descricao: `venda ${ref} usou o código ${reserva.codigo}, mas a reserva está ${atual.status} (desconto concedido sem débito)`,
        referencia: vendaId,
        chave: `reservainvalida:${vendaId}`,
        dados: { reservaId: reserva.id },
      });
      return;
    }
    if (atual.vendaId && atual.vendaId !== vendaId) {
      await this.alertas.divergencia({
        tipo: 'CODIGO_RESGATE_REUTILIZADO',
        severidade: 'ALTA',
        descricao: `código ${reserva.codigo} já conciliado com outra venda`,
        referencia: vendaId,
        chave: `reutilizado:${vendaId}`,
        dados: { reservaId: reserva.id },
      });
      return;
    }
    await this.prisma.reserva.update({
      where: { id: reserva.id },
      data: { vendaId, vendaErpRef: atual.vendaErpRef ?? ref, conciliadaEm: this.relogio.agora() },
    });
    if (atual.valorCentavos !== venda.pagoComCashbackCentavos) {
      await this.alertas.divergencia({
        tipo: 'VALOR_RESGATE_DIVERGENTE',
        severidade: 'MEDIA',
        descricao: `reserva ${reserva.codigo} de R$ ${(atual.valorCentavos / 100).toFixed(2)} × ERP R$ ${(venda.pagoComCashbackCentavos / 100).toFixed(2)}`,
        referencia: vendaId,
        chave: `valordivergente:${vendaId}`,
        dados: { reservaId: reserva.id },
      });
    }
  }

  // ───────────────────────────────────────────── devolução

  async processarDevolucao(
    d: DevolucaoImportada,
    importacaoId: string | null,
    ator: Ator = SISTEMA,
  ) {
    const loja = await this.prisma.loja.findUnique({ where: { codigoErp: d.lojaCodigoErp } });
    if (!loja)
      throw new ErroNegocio('LOJA_DESCONHECIDA', `loja ${d.lojaCodigoErp} não cadastrada`, 422);
    const chave = `${loja.id}:${d.documentoDevolucao}`;
    if (await this.prisma.devolucao.findUnique({ where: { chaveIdempotencia: chave } }))
      return { repetida: true };
    const venda = await this.prisma.venda.findUnique({
      where: { lojaId_documentoErp: { lojaId: loja.id, documentoErp: d.documentoVenda } },
      include: { itens: true },
    });
    if (!venda) {
      await this.alertas.divergencia({
        tipo: 'DEVOLUCAO_SEM_VENDA',
        severidade: 'MEDIA',
        descricao: `devolução ${d.documentoDevolucao} cita a venda ${d.documentoVenda}, ainda não importada`,
        referencia: chave,
        chave: `devsemvenda:${chave}`,
        dados: paraJson(d) as Record<string, unknown>,
      });
      return { repetida: false, pendente: true };
    }
    return this.prisma.transacao(async (tx) => {
      if (await tx.devolucao.findUnique({ where: { chaveIdempotencia: chave } }))
        return { repetida: true };
      const itensVenda = new Map(venda.itens.map((i) => [i.numeroItem, i]));
      const itensDev =
        d.tipo === 'CANCELAMENTO'
          ? venda.itens.map((i) => ({
              numeroItem: i.numeroItem,
              quantidade: i.quantidade.toString(),
              valorCentavos: i.valorLiquidoCentavos,
            }))
          : d.itens.map((i) => {
              const original = itensVenda.get(i.numeroItem);
              if (!original)
                throw new ErroNegocio(
                  'ITEM_INEXISTENTE',
                  `item ${i.numeroItem} não existe na venda ${d.documentoVenda}`,
                  422,
                );
              const valor =
                i.valorCentavos ??
                Number(
                  (BigInt(original.valorLiquidoCentavos) * quantidadeEmMilesimos(i.quantidade)) /
                    (quantidadeEmMilesimos(original.quantidade.toString()) || 1n),
                );
              return {
                numeroItem: i.numeroItem,
                quantidade: i.quantidade,
                valorCentavos: Math.min(valor, original.valorLiquidoCentavos),
              };
            });
      const devolucao = await tx.devolucao.create({
        data: {
          vendaId: venda.id,
          documentoErp: d.documentoDevolucao,
          tipo: d.tipo,
          data: d.data,
          chaveIdempotencia: chave,
          importacaoId,
          itens: {
            create: itensDev.map((i) => ({
              numeroItem: i.numeroItem,
              quantidade: new Prisma.Decimal(i.quantidade || '0'),
              valorCentavos: i.valorCentavos,
              chaveIdempotencia: `${chave}:${i.numeroItem}`,
            })),
          },
        },
      });
      // devolvido ACUMULADO por item (todas as devoluções da venda)
      const todos = await tx.devolucaoItem.findMany({
        where: { devolucao: { vendaId: venda.id } },
      });
      const devolvidoPorItem: Record<string, number> = {};
      for (const i of todos)
        devolvidoPorItem[i.numeroItem] = (devolvidoPorItem[i.numeroItem] ?? 0) + i.valorCentavos;

      const original = venda.calculo as unknown as ResultadoCalculo;
      const config = await this.regras.configuracaoEm(venda.dataConfirmacao, tx);
      const prog = config.programa.parametros;
      const loteCashback = await tx.lancamento.findUnique({
        where: { chaveIdempotencia: `cashback:${venda.chaveIdempotencia}` },
      });
      const loteIndicacao = await tx.lancamento.findUnique({
        where: { chaveIdempotencia: `indicacao:${venda.chaveIdempotencia}` },
      });
      const rec = recalcularAposDevolucao(original, {
        devolvidoPorItem,
        aplicarCompraMinima: prog.devolucao.aplicarCompraMinimaNoRecalculo,
        cashbackConcedidoCentavos: loteCashback?.valorCentavos ?? 0,
        recompensaConcedidaCentavos: loteIndicacao?.valorCentavos ?? 0,
      });
      const motivo = `${d.tipo === 'CANCELAMENTO' ? 'cancelamento' : 'devolução'} ${d.documentoDevolucao} da venda ${venda.documentoErp}`;
      const efeitos: Record<string, unknown> = { recalculo: rec };
      if (loteCashback) {
        efeitos.cashback = await this.livro.estornarLoteAte(tx, {
          loteId: loteCashback.id,
          estornoTotalCentavos: loteCashback.valorCentavos - rec.cashbackDevidoCentavos,
          devolucaoId: devolucao.id,
          vendaId: venda.id,
          chave: `estorno:${chave}:cashback`,
          criadoPor: ator.id ?? 'SISTEMA',
          motivo,
        });
      }
      if (loteIndicacao) {
        efeitos.indicacao = await this.livro.estornarLoteAte(tx, {
          loteId: loteIndicacao.id,
          estornoTotalCentavos: loteIndicacao.valorCentavos - rec.recompensaDevidaCentavos,
          devolucaoId: devolucao.id,
          vendaId: venda.id,
          chave: `estorno:${chave}:indicacao`,
          criadoPor: ator.id ?? 'SISTEMA',
          motivo,
        });
      }
      // devolve à carteira a parcela paga com cashback nos itens devolvidos (D-013)
      if (
        prog.devolucao.recreditarCashbackUtilizado &&
        rec.cashbackUtilizadoDevolvidoCentavos > 0
      ) {
        const ja = await tx.lancamento.aggregate({
          where: { vendaId: venda.id, origem: 'DEVOLUCAO_CASHBACK_UTILIZADO', tipo: 'CREDITO' },
          _sum: { valorCentavos: true },
        });
        const falta = rec.cashbackUtilizadoDevolvidoCentavos - (ja._sum.valorCentavos ?? 0);
        const reserva = await tx.reserva.findFirst({
          where: { vendaId: venda.id, status: 'CONFIRMADA' },
        });
        const carteiraId =
          reserva?.carteiraId ??
          (venda.compradorPessoaId || venda.compradorEmpresaId
            ? (
                await this.livro.obterOuCriarCarteira(tx, 'CLIENTE', {
                  pessoaId: venda.compradorPessoaId,
                  empresaId: venda.compradorEmpresaId,
                })
              ).id
            : null);
        if (falta > 0 && carteiraId) {
          const carteira = await tx.carteira.findUniqueOrThrow({ where: { id: carteiraId } });
          const validade = prog.carteiras[carteira.tipo].validadeDias;
          const agora = this.relogio.agora();
          await this.livro.travar(tx, carteiraId);
          await this.livro.criarLote(tx, {
            carteiraId,
            tipo: 'CREDITO',
            origem: 'DEVOLUCAO_CASHBACK_UTILIZADO',
            valorCentavos: falta,
            estado: 'DISPONIVEL',
            liberadoEm: agora,
            venceEm: calcularVenceEm(agora, validade),
            vendaId: venda.id,
            devolucaoId: devolucao.id,
            chave: `recredito:${chave}`,
            criadoPor: ator.id ?? 'SISTEMA',
            motivo,
            detalhes: { validadeDias: validade },
          });
          await this.livro.quitarSaldoDevedor(tx, carteiraId, agora);
          efeitos.recreditoCentavos = falta;
        }
      }
      const totalmenteDevolvida = venda.itens.every(
        (i) => (devolvidoPorItem[i.numeroItem] ?? 0) >= i.valorLiquidoCentavos,
      );
      await tx.venda.update({
        where: { id: venda.id },
        data: {
          cashbackCentavos: rec.cashbackDevidoCentavos,
          recompensaCentavos: rec.recompensaDevidaCentavos,
          status: d.tipo === 'CANCELAMENTO' || totalmenteDevolvida ? 'CANCELADA' : 'CONFIRMADA',
        },
      });
      await tx.devolucao.update({
        where: { id: devolucao.id },
        data: {
          processadaEm: this.relogio.agora(),
          resultado: paraJson(efeitos) as Prisma.InputJsonValue,
        },
      });
      await this.auditoria.registrar(
        ator,
        'DEVOLUCAO_PROCESSADA',
        'Venda',
        venda.id,
        { depois: efeitos, motivo },
        tx,
      );
      return { repetida: false, devolucaoId: devolucao.id, ...efeitos };
    });
  }
}
