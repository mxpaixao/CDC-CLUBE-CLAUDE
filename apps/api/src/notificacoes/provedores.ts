import { Logger } from '@nestjs/common';

export interface ResultadoEnvio {
  ok: boolean;
  idExterno?: string;
  erro?: string;
}

/** Porta de saída de mensagens. Novos provedores (SMS, push web, e-mail) implementam esta interface. */
export interface ProvedorMensagem {
  readonly nome: string;
  enviar(destino: string, texto: string): Promise<ResultadoEnvio>;
}

/** Provedor de desenvolvimento: escreve no log e guarda em memória (útil em testes). */
export class ProvedorConsole implements ProvedorMensagem {
  readonly nome = 'console';
  private readonly logger = new Logger('Notificador:console');
  static readonly enviadas: { destino: string; texto: string; em: Date }[] = [];

  async enviar(destino: string, texto: string): Promise<ResultadoEnvio> {
    ProvedorConsole.enviadas.push({ destino, texto, em: new Date() });
    if (ProvedorConsole.enviadas.length > 500) ProvedorConsole.enviadas.shift();
    if (process.env.NODE_ENV !== 'test') this.logger.log(`→ ${destino}: ${texto}`);
    return { ok: true, idExterno: `console-${ProvedorConsole.enviadas.length}` };
  }

  static ultimaPara(destino: string) {
    return [...ProvedorConsole.enviadas].reverse().find((m) => m.destino === destino);
  }
}

/**
 * WhatsApp via API HTTP (formato compatível com a WhatsApp Cloud API).
 * Configuração: WHATSAPP_API_URL (ex.: https://graph.facebook.com/v21.0/<phone-id>/messages) e WHATSAPP_API_TOKEN.
 * Mensagens fora da janela de 24h exigem template aprovado — ver docs/OPERACAO.md.
 */
export class ProvedorWhatsApp implements ProvedorMensagem {
  readonly nome = 'whatsapp';
  constructor(
    private readonly url = process.env.WHATSAPP_API_URL ?? '',
    private readonly token = process.env.WHATSAPP_API_TOKEN ?? '',
  ) {}

  async enviar(destino: string, texto: string): Promise<ResultadoEnvio> {
    if (!this.url || !this.token) return { ok: false, erro: 'WhatsApp não configurado' };
    try {
      const r = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: destino.replace('+', ''),
          type: 'text',
          text: { body: texto },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) return { ok: false, erro: `HTTP ${r.status}` };
      const corpo = (await r.json().catch(() => ({}))) as { messages?: { id: string }[] };
      return { ok: true, idExterno: corpo.messages?.[0]?.id };
    } catch (e) {
      return { ok: false, erro: (e as Error).message };
    }
  }
}

export function criarProvedor(nome: string): ProvedorMensagem {
  return nome === 'whatsapp' ? new ProvedorWhatsApp() : new ProvedorConsole();
}
