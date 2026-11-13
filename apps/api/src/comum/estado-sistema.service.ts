import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditoriaService, type Ator } from './auditoria.service';
import { PrismaService, type Tx } from './prisma.service';
import { Relogio } from './relogio';

export interface Contingencia {
  ativa: boolean;
  motivo: string | null;
  desde: string | null;
}

/**
 * Modo contingência: quando a importação/integração falha, novas liberações de crédito ficam
 * pausadas e resgates exigem liberação de supervisor (seção 6 do escopo).
 */
@Injectable()
export class EstadoSistemaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly relogio: Relogio,
    private readonly auditoria: AuditoriaService,
  ) {}

  async contingencia(tx?: Tx): Promise<Contingencia> {
    const r = await (tx ?? this.prisma).estadoSistema.findUnique({
      where: { chave: 'contingencia' },
    });
    return (r?.valor as unknown as Contingencia) ?? { ativa: false, motivo: null, desde: null };
  }

  async definirContingencia(ativa: boolean, motivo: string, ator: Ator) {
    const antes = await this.contingencia();
    if (antes.ativa === ativa) return antes;
    const valor: Contingencia = {
      ativa,
      motivo,
      desde: ativa ? this.relogio.agora().toISOString() : null,
    };
    await this.prisma.estadoSistema.upsert({
      where: { chave: 'contingencia' },
      create: { chave: 'contingencia', valor: valor as unknown as Prisma.InputJsonValue },
      update: { valor: valor as unknown as Prisma.InputJsonValue },
    });
    await this.auditoria.registrar(
      ator,
      ativa ? 'CONTINGENCIA_ATIVADA' : 'CONTINGENCIA_ENCERRADA',
      'EstadoSistema',
      'contingencia',
      { antes, depois: valor, motivo },
    );
    return valor;
  }

  async obter<T>(chave: string): Promise<T | null> {
    const r = await this.prisma.estadoSistema.findUnique({ where: { chave } });
    return (r?.valor as T) ?? null;
  }

  async definir(chave: string, valor: unknown) {
    await this.prisma.estadoSistema.upsert({
      where: { chave },
      create: { chave, valor: valor as Prisma.InputJsonValue },
      update: { valor: valor as Prisma.InputJsonValue },
    });
  }
}
