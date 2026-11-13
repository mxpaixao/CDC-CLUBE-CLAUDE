import { Injectable } from '@nestjs/common';
import { avaliarResgate } from '@cdc/rules';
import {
  identificarDocumento,
  normalizarCodigoPrestador,
  normalizarCodigoResgate,
  normalizarTelefone,
} from '@cdc/shared';
import { AuthService } from '../auth/auth.service';
import { AuditoriaService, type Ator } from '../comum/auditoria.service';
import { ErroNegocio, naoEncontrado } from '../comum/erros';
import { EstadoSistemaService } from '../comum/estado-sistema.service';
import { PrismaService } from '../comum/prisma.service';
import { Relogio } from '../comum/relogio';
import { RegrasService } from '../regras/regras.service';
import { LivroRazaoService } from './livro-razao.service';

/**
 * Tela de caixa da Fase 1 (sem integração em tempo real): consulta, reserva com código de
 * resgate para lançar no ERP, confirmação/cancelamento e pré-registro de indicação.
 */
@Injectable()
export class CaixaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly relogio: Relogio,
    private readonly livro: LivroRazaoService,
    private readonly regras: RegrasService,
    private readonly auth: AuthService,
    private readonly auditoria: AuditoriaService,
    private readonly estado: EstadoSistemaService,
  ) {}

  /** Busca por CPF, CNPJ, telefone ou código/QR do prestador. */
  async consultar(termo: string, valorCompraCentavos?: number) {
    const t = (termo ?? '').trim();
    if (!t)
      throw new ErroNegocio(
        'BUSCA_VAZIA',
        'informe CPF, CNPJ, telefone ou código do prestador',
        400,
      );
    const titulares: {
      pessoaId?: string;
      empresaId?: string;
      nome: string;
      documento: string;
      tipo: 'PESSOA' | 'EMPRESA';
    }[] = [];
    const doc = identificarDocumento(t);
    if (doc?.tipo === 'CPF') {
      const p = await this.prisma.pessoa.findUnique({ where: { cpf: doc.valor } });
      if (p) titulares.push({ pessoaId: p.id, nome: p.nome, documento: p.cpf, tipo: 'PESSOA' });
    } else if (doc?.tipo === 'CNPJ') {
      const e = await this.prisma.empresa.findUnique({ where: { cnpj: doc.valor } });
      if (e)
        titulares.push({
          empresaId: e.id,
          nome: e.razaoSocial,
          documento: e.cnpj,
          tipo: 'EMPRESA',
        });
    } else if (/^cdc/i.test(t) || /\/i\/CDC-/i.test(t)) {
      const codigo = normalizarCodigoPrestador(t.split('/i/').pop() ?? t);
      const pr = await this.prisma.prestador.findUnique({
        where: { codigo },
        include: { pessoa: true },
      });
      if (pr)
        titulares.push({
          pessoaId: pr.pessoaId,
          nome: pr.pessoa.nome,
          documento: pr.pessoa.cpf,
          tipo: 'PESSOA',
        });
    } else {
      const tel = normalizarTelefone(t);
      if (tel)
        for (const p of await this.prisma.pessoa.findMany({ where: { telefone: tel }, take: 5 }))
          titulares.push({ pessoaId: p.id, nome: p.nome, documento: p.cpf, tipo: 'PESSOA' });
    }
    const config = await this.regras.configuracaoAtual();
    const contingencia = await this.estado.contingencia();
    const resultado = [];
    for (const tit of titulares) {
      const participante = tit.pessoaId
        ? await this.prisma.participante.findUnique({ where: { pessoaId: tit.pessoaId } })
        : await this.prisma.participante.findUnique({ where: { empresaId: tit.empresaId } });
      const prestador = tit.pessoaId
        ? await this.prisma.prestador.findUnique({ where: { pessoaId: tit.pessoaId } })
        : null;
      const empresas = tit.pessoaId
        ? await this.prisma.empresaComprador.findMany({
            where: { pessoaId: tit.pessoaId, ativo: true },
            include: { empresa: { include: { participante: true } } },
          })
        : [];
      const carteiras = await this.prisma.carteira.findMany({
        where: {
          OR: [
            tit.pessoaId ? { pessoaId: tit.pessoaId } : { empresaId: tit.empresaId },
            ...empresas.map((e) => ({ empresaId: e.empresaId })),
          ],
        },
        include: { empresa: { select: { razaoSocial: true, cnpj: true } } },
      });
      const comSaldo = [];
      for (const c of carteiras) {
        const saldos = await this.livro.resumo(c.id);
        const params = config.programa.parametros.carteiras[c.tipo];
        const av = avaliarResgate({
          saldoDisponivelCentavos: saldos.disponivelCentavos,
          saldoDevedorCentavos: saldos.devedorCentavos,
          valorCompraCentavos: valorCompraCentavos ?? 0,
          parametros: params,
        });
        const bloqueioPrestador =
          c.tipo === 'PRESTADOR' && prestador?.status !== 'APROVADO'
            ? `prestador ${prestador?.status ?? 'inexistente'}`
            : null;
        const bloqueioParticipante =
          c.tipo === 'CLIENTE' && !c.empresaId && participante?.status !== 'ATIVO'
            ? 'não participante ativo'
            : null;
        comSaldo.push({
          id: c.id,
          tipo: c.tipo,
          empresa: c.empresa,
          saldos,
          limitePorCompraCentavos: av.limitePorCompraCentavos,
          maximoResgatavelCentavos:
            bloqueioPrestador || bloqueioParticipante ? 0 : av.maximoResgatavelCentavos,
          elegivel: av.permitido && !bloqueioPrestador && !bloqueioParticipante,
          motivo: bloqueioPrestador ?? bloqueioParticipante ?? av.motivo,
          exigeAutenticacaoTitular: params.exigeAutenticacaoTitular,
          saldoMinimoResgateCentavos: params.saldoMinimoResgateCentavos,
        });
      }
      resultado.push({
        ...tit,
        participante: participante
          ? {
              id: participante.id,
              status: participante.status,
              dataAdesao: participante.dataAdesao,
            }
          : null,
        prestador: prestador
          ? {
              id: prestador.id,
              status: prestador.status,
              codigo: prestador.codigo,
              nivel: prestador.nivel,
            }
          : null,
        carteiras: comSaldo,
      });
    }
    return { contingencia, titulares: resultado };
  }

  async enviarOtpResgate(carteiraId: string) {
    const carteira = await this.prisma.carteira.findUnique({ where: { id: carteiraId } });
    if (!carteira) throw naoEncontrado('carteira');
    const pessoaId =
      carteira.pessoaId ??
      (
        await this.prisma.empresaComprador.findFirst({
          where: { empresaId: carteira.empresaId!, papel: 'RESPONSAVEL', ativo: true },
        })
      )?.pessoaId;
    const pessoa = pessoaId
      ? await this.prisma.pessoa.findUnique({ where: { id: pessoaId } })
      : null;
    if (!pessoa?.telefone)
      throw new ErroNegocio('SEM_TELEFONE', 'titular sem telefone cadastrado', 422);
    return this.auth.enviarOtp({
      documento: pessoa.cpf,
      telefone: pessoa.telefone,
      finalidade: 'RESGATE',
      pessoaId: pessoa.id,
    });
  }

  async reservar(
    d: {
      carteiraId: string;
      valorCompraCentavos: number;
      valorCentavos: number;
      lojaId: string;
      codigoTitular?: string | null;
      liberacaoSupervisor?: string | null;
      chave: string;
    },
    ator: Ator & { permissoes?: string[] },
  ) {
    const carteira = await this.prisma.carteira.findUnique({ where: { id: d.carteiraId } });
    if (!carteira) throw naoEncontrado('carteira');
    if (carteira.tipo === 'PRESTADOR') {
      const pr = await this.prisma.prestador.findUnique({
        where: { pessoaId: carteira.pessoaId! },
      });
      if (pr?.status !== 'APROVADO')
        throw new ErroNegocio(
          'PRESTADOR_INATIVO',
          `prestador ${pr?.status ?? 'inexistente'}: resgate bloqueado`,
          422,
        );
    } else if (carteira.pessoaId) {
      const p = await this.prisma.participante.findUnique({
        where: { pessoaId: carteira.pessoaId },
      });
      if (p?.status !== 'ATIVO')
        throw new ErroNegocio('PARTICIPANTE_INATIVO', 'titular não é participante ativo', 422);
    }
    if (d.liberacaoSupervisor && !ator.permissoes?.includes('admin')) {
      throw new ErroNegocio(
        'PROIBIDO',
        'liberação em contingência exige usuário supervisor (admin)',
        403,
      );
    }
    let autenticacao: string | null = null;
    if (d.codigoTitular) {
      const pessoaId =
        carteira.pessoaId ??
        (
          await this.prisma.empresaComprador.findFirst({
            where: { empresaId: carteira.empresaId!, papel: 'RESPONSAVEL', ativo: true },
          })
        )?.pessoaId;
      const pessoa = pessoaId
        ? await this.prisma.pessoa.findUnique({ where: { id: pessoaId } })
        : null;
      if (!pessoa) throw new ErroNegocio('TITULAR_NAO_ENCONTRADO', 'titular não encontrado', 422);
      await this.auth.validarOtp(pessoa.cpf, 'RESGATE', d.codigoTitular);
      autenticacao = 'OTP';
    }
    return this.livro.reservar({ ...d, autenticacaoTitular: autenticacao }, ator);
  }

  async porCodigo(codigo: string) {
    const r = await this.prisma.reserva.findUnique({
      where: { codigo: normalizarCodigoResgate(codigo) },
      include: { carteira: true },
    });
    if (!r) throw naoEncontrado('reserva');
    return r;
  }

  reservasAbertas(lojaId?: string) {
    return this.prisma.reserva.findMany({
      where: { status: 'ATIVA', lojaId: lojaId || undefined },
      orderBy: { criadoEm: 'desc' },
      take: 100,
    });
  }

  /** Código do prestador informado ANTES de fechar a venda (orçamento/pedido). */
  async preRegistrarIndicacao(
    d: { lojaId: string; documentoErp: string; codigo: string },
    ator: Ator,
  ) {
    const codigo = normalizarCodigoPrestador(d.codigo);
    const prestador = await this.prisma.prestador.findUnique({ where: { codigo } });
    if (!prestador || prestador.status !== 'APROVADO')
      throw new ErroNegocio('PRESTADOR_INVALIDO', 'código de prestador inválido ou inativo', 422);
    const ja = await this.prisma.venda.findUnique({
      where: { lojaId_documentoErp: { lojaId: d.lojaId, documentoErp: d.documentoErp } },
    });
    if (ja)
      throw new ErroNegocio(
        'VENDA_JA_FECHADA',
        'venda já fechada: alteração de indicador só pelo painel, com justificativa',
        409,
      );
    const existente = await this.prisma.indicacaoPreRegistro.findUnique({
      where: { lojaId_documentoErp: { lojaId: d.lojaId, documentoErp: d.documentoErp } },
    });
    if (existente && existente.prestadorId !== prestador.id)
      throw new ErroNegocio('UM_INDICADOR_POR_VENDA', 'este documento já tem outro indicador', 409);
    const r =
      existente ??
      (await this.prisma.indicacaoPreRegistro.create({
        data: {
          lojaId: d.lojaId,
          documentoErp: d.documentoErp,
          prestadorId: prestador.id,
          operadorId: ator.id ?? 'SISTEMA',
        },
      }));
    await this.auditoria.registrar(ator, 'INDICACAO_PRE_REGISTRADA', 'IndicacaoPreRegistro', r.id, {
      depois: { codigo, documento: d.documentoErp, loja: d.lojaId },
    });
    return { ...r, codigo, agora: this.relogio.agora() };
  }
}
