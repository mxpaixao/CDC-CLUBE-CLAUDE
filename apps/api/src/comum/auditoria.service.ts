import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paraJson } from './json';
import { PrismaService, type Tx } from './prisma.service';

export interface Ator {
  tipo: 'STAFF' | 'PARTICIPANTE' | 'SISTEMA';
  id: string | null;
  ip?: string | null;
}

export const SISTEMA: Ator = { tipo: 'SISTEMA', id: null };

/** Trilha de auditoria append-only (trigger no banco). */
@Injectable()
export class AuditoriaService {
  constructor(private readonly prisma: PrismaService) {}

  async registrar(
    ator: Ator,
    acao: string,
    entidade: string,
    entidadeId: string | null,
    dados: { antes?: unknown; depois?: unknown; motivo?: string | null } = {},
    tx?: Tx,
  ) {
    const cliente = tx ?? this.prisma;
    await cliente.auditoria.create({
      data: {
        ator: ator.tipo,
        usuarioId: ator.id,
        ip: ator.ip ?? null,
        acao,
        entidade,
        entidadeId,
        antes:
          dados.antes === undefined
            ? Prisma.JsonNull
            : (paraJson(dados.antes) as Prisma.InputJsonValue),
        depois:
          dados.depois === undefined
            ? Prisma.JsonNull
            : (paraJson(dados.depois) as Prisma.InputJsonValue),
        motivo: dados.motivo ?? null,
      },
    });
  }
}
