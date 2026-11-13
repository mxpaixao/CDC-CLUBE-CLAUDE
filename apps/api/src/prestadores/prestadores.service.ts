import { Injectable } from '@nestjs/common';
import { type NivelPrestador, type StatusPrestador } from '@prisma/client';
import {
  aplicarTetoMensal,
  calcularNivel,
  calcularVenda,
  detectarPadroesSuspeitos,
  recalcularAposDevolucao,
  verificarAutoindicacao,
} from '@cdc/rules';
import {
  calcularLiberaEm,
  cnpjValido,
  gerarCodigoPrestador,
  intervaloMesCivil,
  normalizarCnpj,
  normalizarCodigoPrestador,
  normalizarTelefone,
  primeiroNome,
  somarDias,
} from '@cdc/shared';
import QRCode from 'qrcode';
import { AuditoriaService, SISTEMA, type Ator } from '../comum/auditoria.service';
import { config } from '../comum/config';
import { ErroNegocio, naoEncontrado } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { Relogio } from '../comum/relogio';
import { LivroRazaoService } from '../carteiras/livro-razao.service';
import { NotificacoesService } from '../notificacoes/notificacoes.service';
import { RegrasService } from '../regras/regras.service';
import { AlertasService } from '../vendas/alertas.service';

export interface Candidatura {
  cnpj?: string | null;
  razaoSocial?: string | null;
  especialidades: string[];
  bairros: string[];
  whatsapp: string;
  fotos?: string[];
  documentos?: string[];
  aceiteTermos: boolean;
  aceiteCodigoConduta: boolean;
  perfilPublico?: boolean;
}

@Injectable()
export class PrestadoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly relogio: Relogio,
    private readonly auditoria: AuditoriaService,
    private readonly livro: LivroRazaoService,
    private readonly regras: RegrasService,
    private readonly notificacoes: NotificacoesService,
    private readonly alertas: AlertasService,
  ) {}

  linkIndicacao(codigo: string) {
    return `${config.urlPublica}/i/${codigo}`;
  }

  /** QR contém APENAS a referência de indicação (link com o código). */
  async qrCode(codigo: string) {
    return QRCode.toDataURL(this.linkIndicacao(codigo), {
      margin: 1,
      width: 320,
      errorCorrectionLevel: 'M',
    });
  }

  async candidatar(pessoaId: string, c: Candidatura, ator: Ator) {
    if (!c.aceiteTermos || !c.aceiteCodigoConduta)
      throw new ErroNegocio('ACEITE_OBRIGATORIO', 'aceite os termos e o código de conduta', 400);
    const especialidadesValidas = new Set(
      (await this.prisma.especialidade.findMany({ where: { ativa: true } })).map((e) => e.id),
    );
    const invalidas = c.especialidades.filter((e) => !especialidadesValidas.has(e));
    if (!c.especialidades.length || invalidas.length)
      throw new ErroNegocio(
        'ESPECIALIDADE_INVALIDA',
        `especialidades inválidas: ${invalidas.join(', ') || 'nenhuma informada'}`,
        400,
      );
    if (!c.bairros.length)
      throw new ErroNegocio(
        'BAIRROS_OBRIGATORIOS',
        'informe ao menos um bairro/zona de atuação',
        400,
      );
    const whatsapp = normalizarTelefone(c.whatsapp);
    if (!whatsapp) throw new ErroNegocio('TELEFONE_INVALIDO', 'WhatsApp inválido', 400);
    const cnpj = c.cnpj ? normalizarCnpj(c.cnpj) : null;
    if (cnpj && !cnpjValido(cnpj)) throw new ErroNegocio('CNPJ_INVALIDO', 'CNPJ/MEI inválido', 400);
    const existente = await this.prisma.prestador.findUnique({ where: { pessoaId } });
    if (existente && existente.status !== 'RECUSADO')
      throw new ErroNegocio(
        'JA_CANDIDATO',
        `já existe cadastro de prestador (${existente.status})`,
        409,
      );
    const agora = this.relogio.agora();
    const dados = {
      cnpj,
      razaoSocial: c.razaoSocial ?? null,
      especialidades: c.especialidades,
      bairros: c.bairros,
      whatsapp,
      fotos: c.fotos ?? [],
      documentos: c.documentos ?? [],
      termosAceitosEm: agora,
      codigoCondutaAceitoEm: agora,
      status: 'PENDENTE' as const,
      motivoStatus: null,
    };
    const prestador = existente
      ? await this.prisma.prestador.update({ where: { id: existente.id }, data: dados })
      : await this.prisma.prestador.create({ data: { pessoaId, ...dados } });
    if (c.perfilPublico !== undefined) {
      await this.prisma.consentimento.create({
        data: {
          pessoaId,
          tipo: 'PERFIL_PUBLICO',
          concedido: c.perfilPublico,
          versaoTermo: 'v1-2026',
          origem: 'APP',
        },
      });
    }
    await this.auditoria.registrar(ator, 'PRESTADOR_CANDIDATURA', 'Prestador', prestador.id, {
      depois: { especialidades: c.especialidades, bairros: c.bairros, cnpj },
    });
    return prestador;
  }

  async listar(filtro: { status?: StatusPrestador; busca?: string }) {
    return this.prisma.prestador.findMany({
      where: {
        status: filtro.status,
        ...(filtro.busca
          ? {
              OR: [
                { codigo: { contains: filtro.busca.toUpperCase() } },
                { pessoa: { nome: { contains: filtro.busca, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: { pessoa: { select: { nome: true, cpf: true, telefone: true } } },
      orderBy: [{ status: 'asc' }, { criadoEm: 'asc' }],
      take: 300,
    });
  }

  async detalhe(id: string) {
    const p = await this.prisma.prestador.findUnique({ where: { id }, include: { pessoa: true } });
    if (!p) throw naoEncontrado('prestador');
    const carteira = await this.prisma.carteira.findFirst({
      where: { pessoaId: p.pessoaId, tipo: 'PRESTADOR' },
    });
    const vendas = await this.prisma.venda.findMany({
      where: { prestadorIndicadorId: id },
      orderBy: { dataConfirmacao: 'desc' },
      take: 100,
      select: {
        id: true,
        lojaId: true,
        documentoErp: true,
        dataConfirmacao: true,
        baseCalculoCentavos: true,
        recompensaCentavos: true,
        recompensaExcedenteCentavos: true,
        status: true,
        origemIndicacao: true,
      },
    });
    const alertas = await this.prisma.alerta.findMany({
      where: { OR: [{ dados: { path: ['prestadorId'], equals: id } }] },
      orderBy: { criadoEm: 'desc' },
      take: 50,
    });
    return {
      prestador: p,
      carteira: carteira ? { ...carteira, saldos: await this.livro.resumo(carteira.id) } : null,
      vendas,
      alertas,
      qr: p.codigo ? await this.qrCode(p.codigo) : null,
      link: p.codigo ? this.linkIndicacao(p.codigo) : null,
    };
  }

  async aprovar(id: string, ator: Ator) {
    const r = await this.prisma.transacao(async (tx) => {
      const p = await tx.prestador.findUnique({ where: { id }, include: { pessoa: true } });
      if (!p) throw naoEncontrado('prestador');
      if (p.status === 'APROVADO') return p;
      if (p.status !== 'PENDENTE' && p.status !== 'SUSPENSO')
        throw new ErroNegocio(
          'STATUS_INVALIDO',
          `não é possível aprovar prestador ${p.status}`,
          409,
        );
      let codigo = p.codigo;
      for (let tentativa = 0; !codigo; tentativa++) {
        const c = gerarCodigoPrestador(p.pessoa.nome, tentativa);
        if (!(await tx.prestador.findUnique({ where: { codigo: c } }))) codigo = c;
      }
      const aprovado = await tx.prestador.update({
        where: { id },
        data: {
          status: 'APROVADO',
          codigo,
          aprovadoPorId: ator.id,
          aprovadoEm: this.relogio.agora(),
          motivoStatus: null,
        },
      });
      await this.livro.obterOuCriarCarteira(tx, 'PRESTADOR', { pessoaId: p.pessoaId });
      await this.auditoria.registrar(
        ator,
        'PRESTADOR_APROVADO',
        'Prestador',
        id,
        { antes: { status: p.status }, depois: { status: 'APROVADO', codigo } },
        tx,
      );
      return aprovado;
    });
    await this.notificacoes
      .agendar({
        pessoaId: r.pessoaId,
        template: 'PRESTADOR_APROVADO',
        dados: { codigo: r.codigo, link: this.linkIndicacao(r.codigo!) },
        chave: `prest-aprovado:${r.id}`,
      })
      .catch(() => null);
    return r;
  }

  async mudarStatus(
    id: string,
    status: Extract<StatusPrestador, 'RECUSADO' | 'SUSPENSO'>,
    motivo: string,
    ator: Ator,
  ) {
    if (!motivo || motivo.trim().length < 5)
      throw new ErroNegocio('MOTIVO_OBRIGATORIO', 'informe o motivo', 400);
    const p = await this.prisma.prestador.findUnique({ where: { id } });
    if (!p) throw naoEncontrado('prestador');
    const r = await this.prisma.prestador.update({
      where: { id },
      data: {
        status,
        motivoStatus: motivo,
        perfilPublico: status === 'SUSPENSO' ? false : p.perfilPublico,
      },
    });
    await this.auditoria.registrar(ator, `PRESTADOR_${status}`, 'Prestador', id, {
      antes: { status: p.status },
      depois: { status },
      motivo,
    });
    return r;
  }

  async definirNivel(id: string, nivel: NivelPrestador, motivo: string, ator: Ator) {
    const p = await this.prisma.prestador.findUnique({ where: { id } });
    if (!p) throw naoEncontrado('prestador');
    const r = await this.prisma.prestador.update({
      where: { id },
      data: { nivel, nivelDefinidoManual: true },
    });
    await this.auditoria.registrar(ator, 'PRESTADOR_NIVEL', 'Prestador', id, {
      antes: { nivel: p.nivel },
      depois: { nivel, manual: true },
      motivo,
    });
    return r;
  }

  /** Área do prestador no app — sem dados sensíveis do comprador (só primeiro nome e valor). */
  async areaDoPrestador(pessoaId: string) {
    const p = await this.prisma.prestador.findUnique({ where: { pessoaId } });
    if (!p) return { prestador: null };
    const carteira = await this.prisma.carteira.findFirst({
      where: { pessoaId, tipo: 'PRESTADOR' },
    });
    const vendas = await this.prisma.venda.findMany({
      where: { prestadorIndicadorId: p.id },
      orderBy: { dataConfirmacao: 'desc' },
      take: 50,
    });
    const nomes = new Map<string, string>();
    for (const v of vendas) {
      if (v.compradorPessoaId && !nomes.has(v.compradorPessoaId))
        nomes.set(
          v.compradorPessoaId,
          primeiroNome(
            (await this.prisma.pessoa.findUnique({ where: { id: v.compradorPessoaId } }))?.nome ??
              '',
          ),
        );
      if (v.compradorEmpresaId && !nomes.has(v.compradorEmpresaId))
        nomes.set(
          v.compradorEmpresaId,
          primeiroNome(
            (await this.prisma.empresa.findUnique({ where: { id: v.compradorEmpresaId } }))
              ?.razaoSocial ?? '',
          ),
        );
    }
    const config = await this.regras.configuracaoAtual();
    const mes = intervaloMesCivil(this.relogio.agora());
    const noMes = await this.prisma.venda.aggregate({
      where: { prestadorIndicadorId: p.id, dataConfirmacao: { gte: mes.inicio, lt: mes.fim } },
      _sum: { recompensaCentavos: true },
    });
    return {
      prestador: {
        id: p.id,
        status: p.status,
        nivel: p.nivel,
        codigo: p.codigo,
        especialidades: p.especialidades,
        bairros: p.bairros,
        motivoStatus: p.motivoStatus,
      },
      link: p.codigo ? this.linkIndicacao(p.codigo) : null,
      qr: p.codigo ? await this.qrCode(p.codigo) : null,
      percentualAtualBps: config.programa.parametros.indicacao.bpsPorNivel[p.nivel],
      tetoMensalCentavos: config.programa.parametros.indicacao.tetoMensalCentavos,
      recompensaNoMesCentavos: noMes._sum.recompensaCentavos ?? 0,
      carteira: carteira ? { id: carteira.id, saldos: await this.livro.resumo(carteira.id) } : null,
      vendasIndicadas: vendas.map((v) => ({
        data: v.dataConfirmacao,
        comprador: nomes.get(v.compradorPessoaId ?? v.compradorEmpresaId ?? '') || 'Cliente',
        valorCentavos: v.baseCalculoCentavos,
        recompensaCentavos: v.recompensaCentavos,
        status: v.status,
      })),
    };
  }

  /** Cliente vincula um prestador pelo app (vale pelo prazo de vínculo configurado). */
  async vincularPeloApp(pessoaId: string, codigoEntrada: string, ator: Ator) {
    const codigo = normalizarCodigoPrestador(codigoEntrada);
    const prestador = await this.prisma.prestador.findUnique({
      where: { codigo },
      include: { pessoa: true },
    });
    if (!prestador || prestador.status !== 'APROVADO')
      throw new ErroNegocio('PRESTADOR_INVALIDO', 'código de prestador inválido', 422);
    const pessoa = await this.prisma.pessoa.findUniqueOrThrow({ where: { id: pessoaId } });
    const af = verificarAutoindicacao({
      comprador: { cpfs: [pessoa.cpf], telefones: pessoa.telefone ? [pessoa.telefone] : [] },
      prestador: {
        cpfTitular: prestador.pessoa.cpf,
        cnpj: prestador.cnpj,
        telefones: [prestador.pessoa.telefone, prestador.whatsapp].filter((t): t is string => !!t),
      },
    });
    if (af.bloqueada)
      throw new ErroNegocio('AUTOINDICACAO', 'não é possível vincular o próprio código', 422);
    const agora = this.relogio.agora();
    const dias = (await this.regras.configuracaoAtual()).programa.parametros.indicacao.vinculoDias;
    const chave = `P:${pessoaId}`;
    const ativo = await this.prisma.vinculoIndicacao.findFirst({
      where: { compradorChave: chave, prestadorId: prestador.id, fim: { gt: agora } },
    });
    const vinculo =
      ativo ??
      (await this.prisma.vinculoIndicacao.create({
        data: {
          compradorChave: chave,
          prestadorId: prestador.id,
          inicio: agora,
          fim: somarDias(agora, dias),
          origem: 'APP',
        },
      }));
    await this.auditoria.registrar(ator, 'VINCULO_APP', 'VinculoIndicacao', vinculo.id, {
      depois: { codigo },
    });
    return {
      prestador: {
        nome: primeiroNome(prestador.pessoa.nome),
        codigo,
        especialidades: prestador.especialidades,
      },
      ate: vinculo.fim,
    };
  }

  /**
   * Troca de indicador APÓS o fechamento: só com permissão e justificativa. Estorna a recompensa do
   * indicador anterior e gera a do novo (com antifraude e teto), tudo auditado.
   */
  async alterarIndicador(
    vendaId: string,
    novoCodigo: string | null,
    justificativa: string,
    ator: Ator,
  ) {
    if (!justificativa || justificativa.trim().length < 10)
      throw new ErroNegocio(
        'JUSTIFICATIVA_OBRIGATORIA',
        'justificativa obrigatória (mín. 10 caracteres)',
        400,
      );
    return this.prisma.transacao(async (tx) => {
      const venda = await tx.venda.findUnique({ where: { id: vendaId } });
      if (!venda) throw naoEncontrado('venda');
      if (venda.status === 'CANCELADA')
        throw new ErroNegocio('VENDA_CANCELADA', 'venda cancelada', 409);
      const novo = novoCodigo
        ? await tx.prestador.findUnique({
            where: { codigo: normalizarCodigoPrestador(novoCodigo) },
            include: { pessoa: true },
          })
        : null;
      if (novoCodigo && (!novo || novo.status !== 'APROVADO'))
        throw new ErroNegocio('PRESTADOR_INVALIDO', 'novo indicador inválido ou inativo', 422);
      if (novo?.id === venda.prestadorIndicadorId) return venda;
      const loteAnterior = await tx.lancamento.findUnique({
        where: { chaveIdempotencia: `indicacao:${venda.chaveIdempotencia}` },
      });
      if (loteAnterior) {
        await this.livro.estornarLoteAte(tx, {
          loteId: loteAnterior.id,
          estornoTotalCentavos: loteAnterior.valorCentavos,
          devolucaoId: null,
          vendaId,
          chave: `troca-indicador:${vendaId}:${loteAnterior.id}`,
          criadoPor: ator.id ?? 'SISTEMA',
          motivo: `troca de indicador: ${justificativa}`,
        });
      }
      let recompensa = 0;
      if (novo) {
        const pessoaComprador = venda.compradorPessoaId
          ? await tx.pessoa.findUnique({ where: { id: venda.compradorPessoaId } })
          : null;
        const af = verificarAutoindicacao({
          comprador: {
            cpfs: [pessoaComprador?.cpf, venda.compradorAutorizadoCpf].filter(
              (c): c is string => !!c,
            ),
            cnpj: venda.compradorEmpresaId ? venda.compradorDocumento : null,
            telefones: pessoaComprador?.telefone ? [pessoaComprador.telefone] : [],
          },
          prestador: {
            cpfTitular: novo.pessoa.cpf,
            cnpj: novo.cnpj,
            telefones: [novo.pessoa.telefone, novo.whatsapp].filter((t): t is string => !!t),
          },
        });
        if (af.bloqueada)
          throw new ErroNegocio('AUTOINDICACAO', `autoindicação: ${af.motivos.join(', ')}`, 422);
        // recalcula com a MESMA configuração da data da venda e o nível do novo prestador
        const config = await this.regras.configuracaoEm(venda.dataConfirmacao, tx);
        const itens = await tx.vendaItem.findMany({ where: { vendaId } });
        const calc = calcularVenda(
          {
            lojaId: venda.lojaId,
            canal: venda.canal,
            instante: venda.dataConfirmacao,
            perfil: venda.perfilAplicado,
            itens: itens.map((i) => ({
              id: i.numeroItem,
              sku: i.sku,
              familia: i.familiaCodigo,
              subfamilia: i.subfamiliaCodigo,
              tipo: i.tipo,
              valorBrutoCentavos: i.valorBrutoCentavos,
              descontoCentavos: i.descontoCentavos,
              custoCentavos: i.custoCentavos,
              emPromocao: i.emPromocao,
              descontoNegociado: i.descontoNegociado,
              tabelaProfissional: i.tabelaProfissional,
            })),
            pagoComCashbackCentavos: venda.pagoComCashbackCentavos,
            compradorParticipante: false,
            boasVindas: false,
            indicacao: { nivel: novo.nivel },
          },
          config,
        );
        const devolvidos = await tx.devolucaoItem.findMany({ where: { devolucao: { vendaId } } });
        const devolvidoPorItem: Record<string, number> = {};
        for (const d of devolvidos)
          devolvidoPorItem[d.numeroItem] = (devolvidoPorItem[d.numeroItem] ?? 0) + d.valorCentavos;
        const valor = devolvidos.length
          ? recalcularAposDevolucao(calc, {
              devolvidoPorItem,
              aplicarCompraMinima:
                config.programa.parametros.devolucao.aplicarCompraMinimaNoRecalculo,
              cashbackConcedidoCentavos: 0,
              recompensaConcedidaCentavos: calc.indicacao.valorCentavos,
            }).recompensaDevidaCentavos
          : calc.indicacao.valorCentavos;
        const cp = await this.livro.obterOuCriarCarteira(tx, 'PRESTADOR', {
          pessoaId: novo.pessoaId,
        });
        await this.livro.travar(tx, cp.id);
        const mes = intervaloMesCivil(venda.dataConfirmacao);
        const acumulado = await tx.venda.aggregate({
          where: {
            prestadorIndicadorId: novo.id,
            dataConfirmacao: { gte: mes.inicio, lt: mes.fim },
            id: { not: vendaId },
          },
          _sum: { recompensaCentavos: true },
        });
        recompensa = aplicarTetoMensal({
          valorCalculadoCentavos: valor,
          jaConcedidoNoMesCentavos: acumulado._sum.recompensaCentavos ?? 0,
          tetoMensalCentavos: config.programa.parametros.indicacao.tetoMensalCentavos,
        }).concedidoCentavos;
        if (recompensa > 0) {
          await this.livro.criarLote(tx, {
            carteiraId: cp.id,
            tipo: 'CREDITO',
            origem: 'INDICACAO',
            valorCentavos: recompensa,
            estado: 'PENDENTE',
            liberaEm: calcularLiberaEm(
              venda.dataConfirmacao,
              config.programa.parametros.carteiras.PRESTADOR.carenciaDias,
            ),
            vendaId,
            regraVersaoId: config.programa.regraVersaoId,
            chave: `indicacao-troca:${vendaId}:${novo.id}`,
            criadoPor: ator.id ?? 'SISTEMA',
            motivo: justificativa,
            detalhes: {
              validadeDias: config.programa.parametros.carteiras.PRESTADOR.validadeDias,
              nivel: novo.nivel,
            },
          });
        }
      }
      const atualizada = await tx.venda.update({
        where: { id: vendaId },
        data: {
          prestadorIndicadorId: novo?.id ?? null,
          origemIndicacao: novo ? 'AJUSTE_MANUAL' : null,
          recompensaCentavos: recompensa,
        },
      });
      await this.auditoria.registrar(
        ator,
        'INDICADOR_ALTERADO',
        'Venda',
        vendaId,
        {
          antes: {
            prestadorIndicadorId: venda.prestadorIndicadorId,
            recompensa: venda.recompensaCentavos,
          },
          depois: { prestadorIndicadorId: novo?.id ?? null, recompensa },
          motivo: justificativa,
        },
        tx,
      );
      return atualizada;
    });
  }

  /** Job: padrões suspeitos de cada prestador (comprador repetido, valores redondos, muitas canceladas). */
  async varrerAntifraude() {
    const agora = this.relogio.agora();
    const params = (await this.regras.configuracaoAtual()).programa.parametros.antifraude;
    const desde = new Date(agora.getTime() - params.janelaDias * 86_400_000);
    const vendas = await this.prisma.venda.findMany({
      where: { prestadorIndicadorId: { not: null }, dataConfirmacao: { gte: desde } },
      select: {
        id: true,
        prestadorIndicadorId: true,
        compradorDocumento: true,
        baseCalculoCentavos: true,
        dataConfirmacao: true,
        status: true,
        devolucoes: { select: { id: true } },
      },
    });
    const porPrestador = new Map<string, typeof vendas>();
    for (const v of vendas)
      porPrestador.set(v.prestadorIndicadorId!, [
        ...(porPrestador.get(v.prestadorIndicadorId!) ?? []),
        v,
      ]);
    let abertos = 0;
    for (const [prestadorId, lista] of porPrestador) {
      const padroes = detectarPadroesSuspeitos(
        lista.map((v) => ({
          vendaId: v.id,
          compradorChave: v.compradorDocumento ?? v.id,
          valorCentavos: v.baseCalculoCentavos,
          instante: v.dataConfirmacao,
          cancelada: v.status === 'CANCELADA' || v.devolucoes.length > 0,
        })),
        params,
        agora,
      );
      for (const p of padroes) {
        await this.alertas.abrir(null, {
          tipo: `ANTIFRAUDE_${p.tipo}`,
          severidade: 'ALTA',
          descricao: p.descricao,
          referencia: prestadorId,
          chave: `af:${prestadorId}:${p.tipo}:${agora.toISOString().slice(0, 10)}`,
          dados: { prestadorId, ...p.dados, vendaIds: p.vendaIds } as Record<string, unknown>,
        });
        abertos++;
      }
    }
    return { prestadores: porPrestador.size, alertas: abertos };
  }

  /** Job mensal: recalcula níveis quando o modo automático estiver ligado (Fase 1: desligado). */
  async recalcularNiveis() {
    const config = await this.regras.configuracaoAtual();
    if (!config.nivel?.parametros.automatico) return { automatico: false, alterados: 0 };
    const agora = this.relogio.agora();
    const desde = new Date(agora.getTime() - config.nivel.parametros.janelaDias * 86_400_000);
    const prestadores = await this.prisma.prestador.findMany({
      where: { status: 'APROVADO', nivelDefinidoManual: false },
    });
    let alterados = 0;
    for (const p of prestadores) {
      const agg = await this.prisma.venda.aggregate({
        where: {
          prestadorIndicadorId: p.id,
          status: 'CONFIRMADA',
          dataConfirmacao: { gte: desde },
        },
        _sum: { baseCalculoCentavos: true },
        _count: { _all: true },
      });
      const nivel = calcularNivel(config.nivel.parametros, {
        volumeIndicadoCentavos: agg._sum.baseCalculoCentavos ?? 0,
        vendasIndicadas: agg._count._all,
      });
      if (nivel !== p.nivel) {
        await this.prisma.prestador.update({ where: { id: p.id }, data: { nivel } });
        await this.auditoria.registrar(SISTEMA, 'PRESTADOR_NIVEL', 'Prestador', p.id, {
          antes: { nivel: p.nivel },
          depois: { nivel, automatico: true },
        });
        alterados++;
      }
    }
    return { automatico: true, alterados };
  }

  especialidades() {
    return this.prisma.especialidade.findMany({ where: { ativa: true }, orderBy: { nome: 'asc' } });
  }
}
