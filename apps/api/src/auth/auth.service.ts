import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { gerarOtp, mascararTelefone, normalizarCpf, cpfValido } from '@cdc/shared';
import * as argon2 from 'argon2';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AuditoriaService } from '../comum/auditoria.service';
import { config } from '../comum/config';
import { ErroNegocio } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { Relogio } from '../comum/relogio';
import { NotificacoesService } from '../notificacoes/notificacoes.service';
import type { UsuarioToken } from './decoradores';

export type FinalidadeOtp = 'LOGIN' | 'CADASTRO' | 'RESGATE';

const OTP_VALIDADE_MIN = 5;
const OTP_MAX_TENTATIVAS = 5;
const OTP_MAX_POR_JANELA = 3;
const OTP_JANELA_MIN = 15;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly relogio: Relogio,
    private readonly auditoria: AuditoriaService,
    private readonly notificacoes: NotificacoesService,
  ) {}

  // ─── Equipe CDC

  async loginEquipe(email: string, senha: string, ip?: string) {
    const usuario = await this.prisma.usuarioCdc.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    const ok = usuario?.ativo
      ? await argon2.verify(usuario.senhaHash, senha).catch(() => false)
      : false;
    if (!usuario || !ok) {
      await this.auditoria.registrar(
        { tipo: 'SISTEMA', id: null, ip },
        'LOGIN_FALHOU',
        'UsuarioCdc',
        usuario?.id ?? null,
        { depois: { email } },
      );
      throw new ErroNegocio('CREDENCIAIS_INVALIDAS', 'e-mail ou senha inválidos', 401);
    }
    await this.prisma.usuarioCdc.update({
      where: { id: usuario.id },
      data: { ultimoAcesso: this.relogio.agora() },
    });
    await this.auditoria.registrar(
      { tipo: 'STAFF', id: usuario.id, ip },
      'LOGIN',
      'UsuarioCdc',
      usuario.id,
    );
    const payload: UsuarioToken = {
      sub: usuario.id,
      tipo: 'STAFF',
      nome: usuario.nome,
      permissoes: usuario.permissoes,
      lojaId: usuario.lojaId,
    };
    return {
      token: await this.jwt.signAsync(payload, { expiresIn: '10h' }),
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        permissoes: usuario.permissoes,
        lojaId: usuario.lojaId,
      },
    };
  }

  static hashSenha(senha: string) {
    if (senha.length < 10)
      throw new ErroNegocio('SENHA_FRACA', 'senha deve ter ao menos 10 caracteres', 400);
    return argon2.hash(senha, { type: argon2.argon2id });
  }

  // ─── OTP

  private hashOtp(codigo: string, documento: string) {
    return createHmac('sha256', config.jwtSecret).update(`${documento}:${codigo}`).digest('hex');
  }

  /** Envia OTP para o telefone. Retorna o telefone mascarado. */
  async enviarOtp(entrada: {
    documento: string;
    telefone: string;
    finalidade: FinalidadeOtp;
    pessoaId?: string | null;
  }) {
    const agora = this.relogio.agora();
    const recentes = await this.prisma.otp.count({
      where: {
        documento: entrada.documento,
        finalidade: entrada.finalidade,
        criadoEm: { gte: new Date(agora.getTime() - OTP_JANELA_MIN * 60_000) },
      },
    });
    if (recentes >= OTP_MAX_POR_JANELA) {
      throw new ErroNegocio(
        'OTP_LIMITE',
        `muitos códigos solicitados; aguarde ${OTP_JANELA_MIN} minutos`,
        429,
      );
    }
    const codigo = gerarOtp();
    await this.prisma.otp.create({
      data: {
        documento: entrada.documento,
        telefone: entrada.telefone,
        finalidade: entrada.finalidade,
        pessoaId: entrada.pessoaId ?? null,
        codigoHash: this.hashOtp(codigo, entrada.documento),
        expiraEm: new Date(agora.getTime() + OTP_VALIDADE_MIN * 60_000),
      },
    });
    const texto =
      entrada.finalidade === 'RESGATE'
        ? `Clube CDC: seu código para usar o saldo no caixa é ${codigo}. Válido por ${OTP_VALIDADE_MIN} min. Não compartilhe por telefone.`
        : `Clube CDC: seu código de acesso é ${codigo}. Válido por ${OTP_VALIDADE_MIN} min.`;
    await this.notificacoes.enviarTransacionalImediata(entrada.telefone, texto);
    return { enviadoPara: mascararTelefone(entrada.telefone), expiraEmMinutos: OTP_VALIDADE_MIN };
  }

  /** Valida e consome o OTP mais recente do documento/finalidade. */
  async validarOtp(documento: string, finalidade: FinalidadeOtp, codigo: string) {
    const agora = this.relogio.agora();
    const otp = await this.prisma.otp.findFirst({
      where: { documento, finalidade, utilizadoEm: null, expiraEm: { gt: agora } },
      orderBy: { criadoEm: 'desc' },
    });
    if (!otp) throw new ErroNegocio('OTP_INVALIDO', 'código inválido ou expirado', 401);
    if (otp.tentativas >= OTP_MAX_TENTATIVAS)
      throw new ErroNegocio('OTP_BLOQUEADO', 'muitas tentativas; solicite um novo código', 429);
    const esperado = Buffer.from(otp.codigoHash, 'hex');
    const recebido = Buffer.from(this.hashOtp(String(codigo).trim(), documento), 'hex');
    if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) {
      await this.prisma.otp.update({
        where: { id: otp.id },
        data: { tentativas: { increment: 1 } },
      });
      throw new ErroNegocio('OTP_INVALIDO', 'código inválido ou expirado', 401);
    }
    const consumido = await this.prisma.otp.updateMany({
      where: { id: otp.id, utilizadoEm: null },
      data: { utilizadoEm: agora },
    });
    if (consumido.count !== 1) throw new ErroNegocio('OTP_INVALIDO', 'código já utilizado', 401);
    return otp;
  }

  /** Login do participante (passo 1). */
  async solicitarOtpLogin(cpfEntrada: string) {
    const cpf = normalizarCpf(cpfEntrada);
    if (!cpfValido(cpf)) throw new ErroNegocio('CPF_INVALIDO', 'CPF inválido', 400);
    const pessoa = await this.prisma.pessoa.findUnique({ where: { cpf } });
    if (!pessoa || !pessoa.telefone || pessoa.anonimizadaEm) {
      // resposta neutra: não revela se o CPF está cadastrado
      return { enviadoPara: null, expiraEmMinutos: OTP_VALIDADE_MIN, cadastrado: false };
    }
    const r = await this.enviarOtp({
      documento: cpf,
      telefone: pessoa.telefone,
      finalidade: 'LOGIN',
      pessoaId: pessoa.id,
    });
    return { ...r, cadastrado: true };
  }

  /** Login do participante (passo 2). */
  async confirmarOtpLogin(cpfEntrada: string, codigo: string, ip?: string) {
    const cpf = normalizarCpf(cpfEntrada);
    await this.validarOtp(cpf, 'LOGIN', codigo);
    const pessoa = await this.prisma.pessoa.findUniqueOrThrow({
      where: { cpf },
      include: { participante: true },
    });
    await this.auditoria.registrar(
      { tipo: 'PARTICIPANTE', id: pessoa.id, ip },
      'LOGIN',
      'Pessoa',
      pessoa.id,
    );
    return this.emitirTokenParticipante(pessoa.id);
  }

  async emitirTokenParticipante(pessoaId: string) {
    const pessoa = await this.prisma.pessoa.findUniqueOrThrow({
      where: { id: pessoaId },
      include: { participante: true },
    });
    const payload: UsuarioToken = {
      sub: pessoa.id,
      tipo: 'PARTICIPANTE',
      nome: pessoa.nome,
      pessoaId: pessoa.id,
      participanteId: pessoa.participante?.id ?? null,
    };
    return {
      token: await this.jwt.signAsync(payload, { expiresIn: '30d' }),
      pessoa: { id: pessoa.id, nome: pessoa.nome },
    };
  }
}
