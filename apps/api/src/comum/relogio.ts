import { Injectable } from '@nestjs/common';

/** Fonte única de "agora" — substituível em testes (cenários de carência, vencimento, expiração). */
@Injectable()
export class Relogio {
  private fixo: Date | null = null;

  agora(): Date {
    return this.fixo ? new Date(this.fixo.getTime()) : new Date();
  }

  /** Somente testes. */
  definir(instante: Date | null) {
    this.fixo = instante ? new Date(instante.getTime()) : null;
  }

  /** Somente testes. */
  avancarMinutos(minutos: number) {
    this.fixo = new Date(this.agora().getTime() + minutos * 60_000);
  }
}
