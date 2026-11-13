import { Injectable } from '@nestjs/common';
import { Prisma, type StatusAlerta, type StatusDivergencia } from '@prisma/client';
import { AuditoriaService, type Ator } from '../comum/auditoria.service';
import { naoEncontrado } from '../comum/erros';
import { PrismaService, type Tx } from '../comum/prisma.service';
import { Relogio } from '../comum/relogio';

export interface NovoAlerta {
  tipo: string;
  severidade: 'BAIXA' | 'MEDIA' | 'ALTA';
  descricao: string;
  referencia?: string | null;
  chave: string;
  dados?: Record<string, unknown>;
}

/** Alertas (antifraude, margem, teto) e divergências de conciliação. Sempre deduplicados pela chave. */
@Injectable()
export class AlertasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly relogio: Relogio,
    private readonly auditoria: AuditoriaService,
  ) {}

  async abrir(tx: Tx | null, a: NovoAlerta) {
    const cliente = tx ?? this.prisma;
    const existe = await cliente.alerta.findUnique({ where: { chave: a.chave } });
    if (existe) return existe;
    return cliente.alerta.create({
      data: {
        tipo: a.tipo,
        severidade: a.severidade,
        descricao: a.descricao,
        referencia: a.referencia ?? null,
        chave: a.chave,
        dados: (a.dados ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async divergencia(d: NovoAlerta & { referencia: string }, tx?: Tx) {
    const cliente = tx ?? this.prisma;
    const existe = await cliente.divergencia.findUnique({ where: { chave: d.chave } });
    if (existe) return existe;
    return cliente.divergencia.create({
      data: {
        tipo: d.tipo,
        severidade: d.severidade,
        descricao: d.descricao,
        referencia: d.referencia,
        chave: d.chave,
        dados: (d.dados ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  listarAlertas(filtro: { tipo?: string; status?: StatusAlerta }) {
    return this.prisma.alerta.findMany({
      where: { tipo: filtro.tipo, status: filtro.status },
      orderBy: { criadoEm: 'desc' },
      take: 300,
    });
  }

  async analisarAlerta(id: string, status: StatusAlerta, ator: Ator) {
    const a = await this.prisma.alerta.findUnique({ where: { id } });
    if (!a) throw naoEncontrado('alerta');
    const r = await this.prisma.alerta.update({
      where: { id },
      data: { status, analisadoPor: ator.id },
    });
    await this.auditoria.registrar(ator, 'ALERTA_ANALISADO', 'Alerta', id, {
      antes: { status: a.status },
      depois: { status },
    });
    return r;
  }

  listarDivergencias(filtro: { status?: StatusDivergencia; tipo?: string }) {
    return this.prisma.divergencia.findMany({
      where: { status: filtro.status, tipo: filtro.tipo },
      orderBy: { criadoEm: 'desc' },
      take: 300,
    });
  }

  async tratarDivergencia(
    id: string,
    d: { status: StatusDivergencia; resolucao?: string | null; responsavelId?: string | null },
    ator: Ator,
  ) {
    const atual = await this.prisma.divergencia.findUnique({ where: { id } });
    if (!atual) throw naoEncontrado('divergência');
    const r = await this.prisma.divergencia.update({
      where: { id },
      data: {
        status: d.status,
        resolucao: d.resolucao ?? atual.resolucao,
        responsavelId: d.responsavelId ?? ator.id,
        resolvidaEm: d.status === 'ABERTA' ? null : this.relogio.agora(),
      },
    });
    await this.auditoria.registrar(ator, 'DIVERGENCIA_TRATADA', 'Divergencia', id, {
      antes: { status: atual.status },
      depois: { status: d.status, resolucao: d.resolucao },
      motivo: d.resolucao ?? null,
    });
    return r;
  }
}
