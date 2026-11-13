import { Injectable } from '@nestjs/common';
import {
  type TipoConsentimento,
  TIPOS_CONSENTIMENTO,
  cnpjValido,
  cpfValido,
  gerarOtp,
  identificarDocumento,
  mascararTelefone,
  normalizarCnpj,
  normalizarCpf,
  normalizarTelefone,
} from '@cdc/shared';
import { createHash, createHmac } from 'node:crypto';
import { AuthService } from '../auth/auth.service';
import { AuditoriaService, type Ator } from '../comum/auditoria.service';
import { config } from '../comum/config';
import { ErroNegocio, naoEncontrado } from '../comum/erros';
import { PrismaService, type Tx } from '../comum/prisma.service';
import { Relogio } from '../comum/relogio';
import { LivroRazaoService } from '../carteiras/livro-razao.service';
import { NotificacoesService } from '../notificacoes/notificacoes.service';

export const VERSAO_TERMO = 'v1-2026';

export interface DadosAdesao {
  tipo: 'CPF' | 'EMPRESA';
  cpf: string;
  nome: string;
  email?: string | null;
  dataNascimento?: string | null;
  cnpj?: string | null;
  razaoSocial?: string | null;
  codigo: string;
  consentimentos: Partial<Record<TipoConsentimento, boolean>>;
  canalAdesao?: string;
}

@Injectable()
export class ParticipantesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly relogio: Relogio,
    private readonly auth: AuthService,
    private readonly auditoria: AuditoriaService,
    private readonly livro: LivroRazaoService,
    private readonly notificacoes: NotificacoesService,
  ) {}

  /**
   * Passo 1 da adesão. Se o CPF já tem telefone cadastrado, o código vai SEMPRE para o telefone
   * cadastrado (evita sequestro de conta por quem só conhece o CPF).
   */
  async solicitarOtpCadastro(cpfEntrada: string, telefoneEntrada: string) {
    const cpf = normalizarCpf(cpfEntrada);
    if (!cpfValido(cpf)) throw new ErroNegocio('CPF_INVALIDO', 'CPF inválido', 400);
    const pessoa = await this.prisma.pessoa.findUnique({ where: { cpf } });
    const telefone = pessoa?.telefone ?? normalizarTelefone(telefoneEntrada);
    if (!telefone)
      throw new ErroNegocio('TELEFONE_INVALIDO', 'telefone inválido (informe DDD + número)', 400);
    return this.auth.enviarOtp({
      documento: cpf,
      telefone,
      finalidade: 'CADASTRO',
      pessoaId: pessoa?.id ?? null,
    });
  }

  async aderir(d: DadosAdesao, ator: Ator) {
    const cpf = normalizarCpf(d.cpf);
    if (!cpfValido(cpf)) throw new ErroNegocio('CPF_INVALIDO', 'CPF inválido', 400);
    if (d.consentimentos.ADESAO_PROGRAMA !== true) {
      throw new ErroNegocio(
        'CONSENTIMENTO_OBRIGATORIO',
        'é preciso aceitar o regulamento do Clube para aderir',
        400,
      );
    }
    let cnpj: string | null = null;
    if (d.tipo === 'EMPRESA') {
      cnpj = normalizarCnpj(d.cnpj ?? '');
      if (!cnpjValido(cnpj)) throw new ErroNegocio('CNPJ_INVALIDO', 'CNPJ inválido', 400);
      if (!d.razaoSocial?.trim())
        throw new ErroNegocio('RAZAO_SOCIAL', 'informe a razão social', 400);
    }
    const otp = await this.auth.validarOtp(cpf, 'CADASTRO', d.codigo);
    const agora = this.relogio.agora();

    const resultado = await this.prisma.transacao(async (tx) => {
      let pessoa = await tx.pessoa.findUnique({ where: { cpf } });
      if (!pessoa) {
        pessoa = await tx.pessoa.create({
          data: {
            cpf,
            nome: d.nome.trim(),
            telefone: otp.telefone,
            email: d.email?.trim() || null,
            dataNascimento: d.dataNascimento ? new Date(d.dataNascimento) : null,
          },
        });
      } else if (!pessoa.telefone) {
        pessoa = await tx.pessoa.update({
          where: { id: pessoa.id },
          data: { telefone: otp.telefone },
        });
      }
      let participante;
      if (d.tipo === 'CPF') {
        const existente = await tx.participante.findUnique({ where: { pessoaId: pessoa.id } });
        if (existente?.status === 'ATIVO')
          throw new ErroNegocio('JA_PARTICIPANTE', 'este CPF já participa do Clube', 409);
        participante = existente
          ? await tx.participante.update({
              where: { id: existente.id },
              data: { status: 'ATIVO', dataAdesao: agora, excluidoEm: null },
            })
          : await tx.participante.create({
              data: {
                tipo: 'CPF',
                pessoaId: pessoa.id,
                dataAdesao: agora,
                canalAdesao: d.canalAdesao ?? 'APP',
              },
            });
        await this.livro.obterOuCriarCarteira(tx, 'CLIENTE', { pessoaId: pessoa.id });
      } else {
        const empresa =
          (await tx.empresa.findUnique({ where: { cnpj: cnpj! } })) ??
          (await tx.empresa.create({ data: { cnpj: cnpj!, razaoSocial: d.razaoSocial!.trim() } }));
        const existente = await tx.participante.findUnique({ where: { empresaId: empresa.id } });
        if (existente?.status === 'ATIVO')
          throw new ErroNegocio(
            'EMPRESA_JA_PARTICIPANTE',
            'esta empresa já participa do Clube',
            409,
          );
        await tx.empresaComprador.upsert({
          where: { empresaId_pessoaId: { empresaId: empresa.id, pessoaId: pessoa.id } },
          create: { empresaId: empresa.id, pessoaId: pessoa.id, papel: 'RESPONSAVEL' },
          update: { papel: 'RESPONSAVEL', ativo: true },
        });
        participante = existente
          ? await tx.participante.update({
              where: { id: existente.id },
              data: { status: 'ATIVO', dataAdesao: agora },
            })
          : await tx.participante.create({
              data: {
                tipo: 'EMPRESA',
                empresaId: empresa.id,
                dataAdesao: agora,
                canalAdesao: d.canalAdesao ?? 'APP',
              },
            });
        await this.livro.obterOuCriarCarteira(tx, 'CLIENTE', { empresaId: empresa.id });
      }
      await this.registrarConsentimentos(
        tx,
        pessoa.id,
        d.consentimentos,
        ator.tipo === 'STAFF' ? 'PAINEL' : 'APP',
        ator.ip ?? null,
      );
      await this.auditoria.registrar(
        ator,
        'ADESAO',
        'Participante',
        participante.id,
        { depois: { tipo: d.tipo, pessoaId: pessoa.id, cnpj } },
        tx,
      );
      return { pessoa, participante };
    });
    const sessao = await this.auth.emitirTokenParticipante(resultado.pessoa.id);
    return { participante: resultado.participante, ...sessao };
  }

  async registrarConsentimentos(
    tx: Tx,
    pessoaId: string,
    c: Partial<Record<TipoConsentimento, boolean>>,
    origem: string,
    ip: string | null,
  ) {
    for (const tipo of TIPOS_CONSENTIMENTO) {
      const valor = c[tipo];
      if (valor === undefined) continue;
      await tx.consentimento.create({
        data: { pessoaId, tipo, concedido: valor, versaoTermo: VERSAO_TERMO, origem, ip },
      });
    }
  }

  async atualizarConsentimentos(
    pessoaId: string,
    c: Partial<Record<TipoConsentimento, boolean>>,
    ator: Ator,
  ) {
    if (c.ADESAO_PROGRAMA === false) {
      throw new ErroNegocio('USE_EXCLUSAO', 'para deixar o Clube use a exclusão de conta', 400);
    }
    await this.prisma.transacao(async (tx) => {
      await this.registrarConsentimentos(
        tx,
        pessoaId,
        c,
        ator.tipo === 'STAFF' ? 'PAINEL' : 'APP',
        ator.ip ?? null,
      );
      await this.auditoria.registrar(ator, 'CONSENTIMENTOS', 'Pessoa', pessoaId, { depois: c }, tx);
    });
    return this.notificacoes.consentimentosVigentes(pessoaId);
  }

  async perfil(pessoaId: string) {
    const pessoa = await this.prisma.pessoa.findUnique({
      where: { id: pessoaId },
      include: {
        participante: true,
        prestador: true,
        empresas: {
          where: { ativo: true },
          include: { empresa: { include: { participante: true } } },
        },
      },
    });
    if (!pessoa) throw naoEncontrado('pessoa');
    return {
      id: pessoa.id,
      cpf: pessoa.cpf,
      nome: pessoa.nome,
      telefone: pessoa.telefone ? mascararTelefone(pessoa.telefone) : null,
      email: pessoa.email,
      participante: pessoa.participante,
      prestador: pessoa.prestador
        ? {
            id: pessoa.prestador.id,
            status: pessoa.prestador.status,
            nivel: pessoa.prestador.nivel,
            codigo: pessoa.prestador.codigo,
          }
        : null,
      empresas: pessoa.empresas.map((e) => ({
        empresaId: e.empresaId,
        cnpj: e.empresa.cnpj,
        razaoSocial: e.empresa.razaoSocial,
        papel: e.papel,
        participante: e.empresa.participante,
      })),
      consentimentos: await this.notificacoes.consentimentosVigentes(pessoa.id),
    };
  }

  async atualizarPerfil(pessoaId: string, d: { nome?: string; email?: string | null }, ator: Ator) {
    const antes = await this.prisma.pessoa.findUniqueOrThrow({ where: { id: pessoaId } });
    const depois = await this.prisma.pessoa.update({
      where: { id: pessoaId },
      data: {
        nome: d.nome?.trim() || antes.nome,
        email: d.email === undefined ? antes.email : d.email?.trim() || null,
      },
    });
    await this.auditoria.registrar(ator, 'PERFIL_ATUALIZADO', 'Pessoa', pessoaId, {
      antes: { nome: antes.nome, email: antes.email },
      depois: { nome: depois.nome, email: depois.email },
    });
    return depois;
  }

  /**
   * Exclusão de conta (LGPD): anonimiza dados pessoais, encerra a participação e revoga
   * consentimentos. Vendas e lançamentos são mantidos (obrigação legal/contábil), sem identificação.
   * Saldo remanescente é perdido — o app exige confirmação explícita.
   */
  async excluirConta(pessoaId: string, confirmacao: boolean, ator: Ator) {
    if (!confirmacao)
      throw new ErroNegocio(
        'CONFIRMACAO_OBRIGATORIA',
        'confirme a exclusão (o saldo restante será perdido)',
        400,
      );
    const agora = this.relogio.agora();
    return this.prisma.transacao(async (tx) => {
      const pessoa = await tx.pessoa.findUniqueOrThrow({
        where: { id: pessoaId },
        include: { participante: true, prestador: true },
      });
      if (pessoa.anonimizadaEm) return { ok: true };
      const cpfAnon = `ANON-${createHmac('sha256', config.jwtSecret).update(pessoa.cpf).digest('hex').slice(0, 24)}`;
      await this.registrarConsentimentos(
        tx,
        pessoa.id,
        Object.fromEntries(TIPOS_CONSENTIMENTO.map((t) => [t, false])) as Record<
          TipoConsentimento,
          boolean
        >,
        'EXCLUSAO',
        ator.ip ?? null,
      );
      await tx.pessoa.update({
        where: { id: pessoa.id },
        data: {
          cpf: cpfAnon,
          nome: 'Titular removido (LGPD)',
          telefone: null,
          email: null,
          dataNascimento: null,
          anonimizadaEm: agora,
        },
      });
      if (pessoa.participante)
        await tx.participante.update({
          where: { id: pessoa.participante.id },
          data: { status: 'EXCLUIDO', excluidoEm: agora },
        });
      if (pessoa.prestador) {
        await tx.prestador.update({
          where: { id: pessoa.prestador.id },
          data: {
            status: 'SUSPENSO',
            perfilPublico: false,
            whatsapp: null,
            fotos: [],
            documentos: [],
            motivoStatus: 'conta excluída pelo titular',
          },
        });
      }
      await tx.empresaComprador.updateMany({
        where: { pessoaId: pessoa.id },
        data: { ativo: false },
      });
      await tx.notificacao.updateMany({
        where: { pessoaId: pessoa.id, status: 'PENDENTE' },
        data: { status: 'CANCELADA', destino: '' },
      });
      await tx.otp.deleteMany({ where: { pessoaId: pessoa.id } });
      await this.auditoria.registrar(
        ator,
        'EXCLUSAO_LGPD',
        'Pessoa',
        pessoa.id,
        { depois: { refCpf: createHash('sha256').update(cpfAnon).digest('hex').slice(0, 12) } },
        tx,
      );
      return { ok: true };
    });
  }

  async adicionarComprador(
    empresaId: string,
    d: { cpf: string; nome: string; telefone?: string | null },
    ator: Ator,
  ) {
    const cpf = normalizarCpf(d.cpf);
    if (!cpfValido(cpf)) throw new ErroNegocio('CPF_INVALIDO', 'CPF inválido', 400);
    return this.prisma.transacao(async (tx) => {
      const pessoa =
        (await tx.pessoa.findUnique({ where: { cpf } })) ??
        (await tx.pessoa.create({
          data: {
            cpf,
            nome: d.nome.trim(),
            telefone: d.telefone ? normalizarTelefone(d.telefone) : null,
          },
        }));
      const vinculo = await tx.empresaComprador.upsert({
        where: { empresaId_pessoaId: { empresaId, pessoaId: pessoa.id } },
        create: { empresaId, pessoaId: pessoa.id, papel: 'COMPRADOR' },
        update: { ativo: true },
      });
      await this.auditoria.registrar(
        ator,
        'COMPRADOR_AUTORIZADO',
        'Empresa',
        empresaId,
        { depois: { pessoaId: pessoa.id } },
        tx,
      );
      return vinculo;
    });
  }

  /** Busca da equipe: CPF, CNPJ, telefone ou nome. */
  async buscar(termo: string) {
    const t = termo.trim();
    const doc = identificarDocumento(t);
    if (doc?.tipo === 'CPF') {
      const p = await this.prisma.pessoa.findUnique({
        where: { cpf: doc.valor },
        include: { participante: true, prestador: true },
      });
      return p ? [this.resumoPessoa(p)] : [];
    }
    if (doc?.tipo === 'CNPJ') {
      const e = await this.prisma.empresa.findUnique({
        where: { cnpj: doc.valor },
        include: { participante: true },
      });
      return e
        ? [
            {
              tipo: 'EMPRESA' as const,
              id: e.id,
              nome: e.razaoSocial,
              documento: e.cnpj,
              participante: e.participante,
              prestador: null,
            },
          ]
        : [];
    }
    const tel = normalizarTelefone(t);
    if (tel) {
      const ps = await this.prisma.pessoa.findMany({
        where: { telefone: tel },
        include: { participante: true, prestador: true },
        take: 10,
      });
      return ps.map((p) => this.resumoPessoa(p));
    }
    if (t.length < 3) return [];
    const [ps, es] = await Promise.all([
      this.prisma.pessoa.findMany({
        where: { nome: { contains: t, mode: 'insensitive' }, anonimizadaEm: null },
        include: { participante: true, prestador: true },
        take: 20,
      }),
      this.prisma.empresa.findMany({
        where: { razaoSocial: { contains: t, mode: 'insensitive' } },
        include: { participante: true },
        take: 10,
      }),
    ]);
    return [
      ...ps.map((p) => this.resumoPessoa(p)),
      ...es.map((e) => ({
        tipo: 'EMPRESA' as const,
        id: e.id,
        nome: e.razaoSocial,
        documento: e.cnpj,
        participante: e.participante,
        prestador: null,
      })),
    ];
  }

  private resumoPessoa(p: {
    id: string;
    nome: string;
    cpf: string;
    telefone: string | null;
    participante: unknown;
    prestador: { id: string; status: string; codigo: string | null; nivel: string } | null;
  }) {
    return {
      tipo: 'PESSOA' as const,
      id: p.id,
      nome: p.nome,
      documento: p.cpf,
      telefone: p.telefone,
      participante: p.participante,
      prestador: p.prestador
        ? {
            id: p.prestador.id,
            status: p.prestador.status,
            codigo: p.prestador.codigo,
            nivel: p.prestador.nivel,
          }
        : null,
    };
  }

  /** Carteiras de um titular (pessoa ou empresa) com saldos. */
  async carteirasDoTitular(t: { pessoaId?: string; empresaId?: string }) {
    const carteiras = await this.prisma.carteira.findMany({
      where: t.pessoaId ? { pessoaId: t.pessoaId } : { empresaId: t.empresaId },
    });
    return Promise.all(
      carteiras.map(async (c) => ({ ...c, saldos: await this.livro.resumo(c.id) })),
    );
  }

  async detalheEquipe(tipo: 'PESSOA' | 'EMPRESA', id: string) {
    if (tipo === 'PESSOA') {
      const pessoa = await this.prisma.pessoa.findUnique({
        where: { id },
        include: { participante: true, prestador: true, empresas: { include: { empresa: true } } },
      });
      if (!pessoa) throw naoEncontrado('pessoa');
      const compras = await this.prisma.venda.findMany({
        where: { compradorPessoaId: id },
        orderBy: { dataConfirmacao: 'desc' },
        take: 50,
        select: {
          id: true,
          lojaId: true,
          documentoErp: true,
          dataConfirmacao: true,
          baseCalculoCentavos: true,
          cashbackCentavos: true,
          perfilAplicado: true,
          status: true,
        },
      });
      return {
        pessoa,
        carteiras: await this.carteirasDoTitular({ pessoaId: id }),
        compras,
        consentimentos: await this.notificacoes.consentimentosVigentes(id),
      };
    }
    const empresa = await this.prisma.empresa.findUnique({
      where: { id },
      include: {
        participante: true,
        compradores: { include: { pessoa: { select: { id: true, nome: true, cpf: true } } } },
      },
    });
    if (!empresa) throw naoEncontrado('empresa');
    const compras = await this.prisma.venda.findMany({
      where: { compradorEmpresaId: id },
      orderBy: { dataConfirmacao: 'desc' },
      take: 50,
      select: {
        id: true,
        lojaId: true,
        documentoErp: true,
        dataConfirmacao: true,
        baseCalculoCentavos: true,
        cashbackCentavos: true,
        perfilAplicado: true,
        status: true,
      },
    });
    return { empresa, carteiras: await this.carteirasDoTitular({ empresaId: id }), compras };
  }

  /** "Usar no caixa": código de 6 dígitos exibido no app, vale como autenticação do titular por 10 min. */
  async gerarCodigoCaixa(pessoaId: string) {
    const pessoa = await this.prisma.pessoa.findUniqueOrThrow({ where: { id: pessoaId } });
    const codigo = gerarOtp();
    const agora = this.relogio.agora();
    await this.prisma.otp.create({
      data: {
        pessoaId,
        documento: pessoa.cpf,
        telefone: pessoa.telefone ?? '',
        finalidade: 'RESGATE',
        codigoHash: createHmac('sha256', config.jwtSecret)
          .update(`${pessoa.cpf}:${codigo}`)
          .digest('hex'),
        expiraEm: new Date(agora.getTime() + 10 * 60_000),
      },
    });
    return { codigo, cpf: pessoa.cpf, expiraEm: new Date(agora.getTime() + 10 * 60_000) };
  }
}
