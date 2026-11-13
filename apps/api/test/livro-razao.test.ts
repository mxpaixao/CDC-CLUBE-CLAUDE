/**
 * Livro-razão contra PostgreSQL real: cenários de aceite 7, 9, 10, 18 e 20 (seção 11),
 * imutabilidade, liberação/vencimento e saldo devedor.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { calcularLiberaEm } from '@cdc/shared';
import { LivroRazaoService } from '../src/carteiras/livro-razao.service';
import { SISTEMA } from '../src/comum/auditoria.service';
import { type Ambiente, criarAmbiente, limparBanco } from './ambiente';
import { semearBase } from '../prisma/seed-dados';
import { IMPLANTACAO, SENHA_ADMIN } from './ambiente';

const AGORA = new Date('2026-03-10T15:00:00Z'); // 10/03 11:00 Manaus
const OPERADOR = { tipo: 'STAFF' as const, id: 'operador-teste' };

let amb: Ambiente;
let livro: LivroRazaoService;
let carteiraId: string;

async function novaCarteira(cpf = '52998224725') {
  const pessoa = await amb.prisma.pessoa.create({
    data: { cpf, nome: 'Maria Teste', telefone: '+5592991110000' },
  });
  const c = await amb.prisma.transacao((tx) =>
    livro.obterOuCriarCarteira(tx, 'CLIENTE', { pessoaId: pessoa.id }),
  );
  return c.id;
}

async function creditoDisponivel(
  valor: number,
  chave: string,
  venceEm = new Date('2026-04-30T03:59:59.999Z'),
) {
  return amb.prisma.transacao(async (tx) => {
    const { lancamento } = await livro.criarLote(tx, {
      carteiraId,
      tipo: 'CREDITO',
      origem: 'COMPRA',
      valorCentavos: valor,
      estado: 'DISPONIVEL',
      liberadoEm: AGORA,
      venceEm,
      chave,
      criadoPor: 'teste',
    });
    return lancamento;
  });
}

beforeAll(async () => {
  amb = await criarAmbiente(AGORA);
  livro = amb.get(LivroRazaoService);
});
afterAll(async () => amb.app.close());
beforeEach(async () => {
  amb.relogio.definir(AGORA);
  await limparBanco(amb.prisma);
  await semearBase(amb.prisma, IMPLANTACAO, SENHA_ADMIN);
  carteiraId = await novaCarteira();
});

describe('cenários de aceite com banco', () => {
  it('07. duas reservas simultâneas do mesmo saldo → só uma é aceita', async () => {
    await creditoDisponivel(1_000, 'c1');
    const tentativa = (chave: string) =>
      livro.reservar(
        {
          carteiraId,
          valorCompraCentavos: 100_000,
          valorCentavos: 1_000,
          lojaId: 'LOJA-01',
          chave,
        },
        OPERADOR,
      );
    const resultados = await Promise.allSettled([
      tentativa('r1'),
      tentativa('r2'),
      tentativa('r3'),
    ]);
    const aceitas = resultados.filter((r) => r.status === 'fulfilled');
    const recusadas = resultados.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(aceitas).toHaveLength(1);
    expect(recusadas).toHaveLength(2);
    for (const r of recusadas)
      expect(['VALOR_ACIMA_DO_SALDO', 'SALDO_ABAIXO_MINIMO']).toContain(r.reason.codigo);
    const resumo = await livro.resumo(carteiraId);
    expect(resumo).toMatchObject({ disponivelCentavos: 0, reservadoCentavos: 1_000 });
  });

  it('18. reserva não confirmada expira em 30 min e libera o saldo', async () => {
    await creditoDisponivel(2_000, 'c1');
    const reserva = await livro.reservar(
      {
        carteiraId,
        valorCompraCentavos: 10_000,
        valorCentavos: 2_000,
        lojaId: 'LOJA-01',
        chave: 'r1',
      },
      OPERADOR,
    );
    expect(reserva.expiraEm.toISOString()).toBe('2026-03-10T15:30:00.000Z');
    amb.relogio.avancarMinutos(29);
    expect((await livro.resumo(carteiraId)).disponivelCentavos).toBe(0);
    amb.relogio.avancarMinutos(1);
    expect((await livro.resumo(carteiraId)).disponivelCentavos).toBe(2_000);
    await expect(livro.confirmarReserva(reserva.id, 'NF-1', OPERADOR)).rejects.toMatchObject({
      codigo: 'RESERVA_INDISPONIVEL',
    });
    expect(await livro.expirarReservas()).toEqual({ expiradas: 1 });
    expect((await amb.prisma.reserva.findUniqueOrThrow({ where: { id: reserva.id } })).status).toBe(
      'EXPIRADA',
    );
  });

  it('09. devolução parcial antes do uso → estorno proporcional no lote', async () => {
    const lote = await creditoDisponivel(600, 'c1');
    const r = await amb.prisma.transacao((tx) =>
      livro.estornarLoteAte(tx, {
        loteId: lote.id,
        estornoTotalCentavos: 300,
        devolucaoId: null,
        vendaId: null,
        chave: 'dev1',
        criadoPor: 'teste',
        motivo: 'devolução parcial',
      }),
    );
    expect(r).toMatchObject({ estornadoDoLoteCentavos: 300, saldoDevedorCentavos: 0 });
    expect((await livro.resumo(carteiraId)).disponivelCentavos).toBe(300);
    // idempotente: o mesmo total acumulado não estorna de novo
    await amb.prisma.transacao((tx) =>
      livro.estornarLoteAte(tx, {
        loteId: lote.id,
        estornoTotalCentavos: 300,
        devolucaoId: null,
        vendaId: null,
        chave: 'dev1-repetida',
        criadoPor: 'teste',
        motivo: 'repetição',
      }),
    );
    expect((await livro.resumo(carteiraId)).disponivelCentavos).toBe(300);
  });

  it('10. devolução após uso → saldo devedor, bloqueio de resgate e quitação com créditos futuros', async () => {
    const lote = await creditoDisponivel(600, 'c1');
    const reserva = await livro.reservar(
      {
        carteiraId,
        valorCompraCentavos: 3_000,
        valorCentavos: 600,
        lojaId: 'LOJA-01',
        chave: 'r1',
      },
      OPERADOR,
    );
    await livro.confirmarReserva(reserva.id, 'NF-10', OPERADOR);
    await amb.prisma.transacao((tx) =>
      livro.estornarLoteAte(tx, {
        loteId: lote.id,
        estornoTotalCentavos: 600,
        devolucaoId: null,
        vendaId: null,
        chave: 'dev',
        criadoPor: 'teste',
        motivo: 'devolução total',
      }),
    );
    expect(await livro.resumo(carteiraId)).toMatchObject({
      disponivelCentavos: 0,
      devedorCentavos: 600,
    });

    // novo crédito pendente: ao liberar, abate a dívida primeiro
    await amb.prisma.transacao((tx) =>
      livro.criarLote(tx, {
        carteiraId,
        tipo: 'CREDITO',
        origem: 'COMPRA',
        valorCentavos: 1_000,
        estado: 'PENDENTE',
        liberaEm: calcularLiberaEm(AGORA, 7),
        chave: 'c2',
        criadoPor: 'teste',
        detalhes: { validadeDias: 30 },
      }),
    );
    await expect(
      livro.reservar(
        {
          carteiraId,
          valorCompraCentavos: 100_000,
          valorCentavos: 500,
          lojaId: 'LOJA-01',
          chave: 'r2',
        },
        OPERADOR,
      ),
    ).rejects.toMatchObject({ codigo: 'SALDO_DEVEDOR' });
    amb.relogio.definir(new Date('2026-03-17T04:00:00Z'));
    expect(await livro.liberarPendentes()).toMatchObject({ liberados: 1, valorCentavos: 1_000 });
    expect(await livro.resumo(carteiraId)).toMatchObject({
      disponivelCentavos: 400,
      devedorCentavos: 0,
    });
    // resgate volta a ser permitido (saldo 400 < mínimo 500 → bloqueio agora é por mínimo, não por dívida)
    await expect(
      livro.reservar(
        {
          carteiraId,
          valorCompraCentavos: 100_000,
          valorCentavos: 400,
          lojaId: 'LOJA-01',
          chave: 'r3',
        },
        OPERADOR,
      ),
    ).rejects.toMatchObject({ codigo: 'SALDO_ABAIXO_MINIMO' });
  });

  it('20. ajuste manual sem motivo → rejeitado (HTTP 400) e com motivo → aceito e auditado', async () => {
    const semMotivo = await amb
      .http()
      .post(`/carteiras/${carteiraId}/ajustes`)
      .set('Authorization', `Bearer ${amb.tokenAdmin}`)
      .send({ valorCentavos: 1_000 });
    expect(semMotivo.status).toBe(400);
    expect(semMotivo.body.erro).toBe('AJUSTE_INVALIDO');
    const ok = await amb
      .http()
      .post(`/carteiras/${carteiraId}/ajustes`)
      .set('Authorization', `Bearer ${amb.tokenAdmin}`)
      .set('Idempotency-Key', 'aj-1')
      .send({ valorCentavos: 1_000, motivo: 'bonificação por reclamação atendida' });
    expect(ok.status).toBe(201);
    const repetido = await amb
      .http()
      .post(`/carteiras/${carteiraId}/ajustes`)
      .set('Authorization', `Bearer ${amb.tokenAdmin}`)
      .set('Idempotency-Key', 'aj-1')
      .send({ valorCentavos: 1_000, motivo: 'bonificação por reclamação atendida' });
    expect(repetido.headers['idempotent-replay']).toBe('true');
    expect((await livro.resumo(carteiraId)).disponivelCentavos).toBe(1_000);
    const conflito = await amb
      .http()
      .post(`/carteiras/${carteiraId}/ajustes`)
      .set('Authorization', `Bearer ${amb.tokenAdmin}`)
      .set('Idempotency-Key', 'aj-1')
      .send({ valorCentavos: 2_000, motivo: 'outro valor com a mesma chave' });
    expect(conflito.status).toBe(409);
    const auditoria = await amb.prisma.auditoria.findMany({ where: { acao: 'AJUSTE_SALDO' } });
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0].motivo).toBe('bonificação por reclamação atendida');
  });
});

describe('livro-razão', () => {
  it('é imutável: banco recusa alterar valor e apagar lançamento', async () => {
    const lote = await creditoDisponivel(500, 'c1');
    await expect(
      amb.prisma.$executeRawUnsafe(
        `UPDATE lancamento SET "valorCentavos" = 99999 WHERE id = '${lote.id}'`,
      ),
    ).rejects.toThrow(/imutável/);
    await expect(
      amb.prisma.$executeRawUnsafe(`DELETE FROM lancamento WHERE id = '${lote.id}'`),
    ).rejects.toThrow(/imutável/);
    await expect(
      amb.prisma.$executeRawUnsafe(
        `UPDATE lancamento SET estado = 'PENDENTE' WHERE id = '${lote.id}'`,
      ),
    ).rejects.toThrow(/transição/);
    await amb.prisma.auditoria.create({
      data: { ator: 'SISTEMA', acao: 'TESTE', entidade: 'Teste' },
    });
    await expect(amb.prisma.$executeRawUnsafe(`DELETE FROM auditoria`)).rejects.toThrow(
      /append-only/,
    );
    await expect(amb.prisma.$executeRawUnsafe(`UPDATE auditoria SET acao = 'X'`)).rejects.toThrow(
      /append-only/,
    );
  });

  it('libera na data local correta e vence no fim do dia local, preservando o que está reservado', async () => {
    // venda confirmada 10/03 23:30 Manaus
    await amb.prisma.transacao((tx) =>
      livro.criarLote(tx, {
        carteiraId,
        tipo: 'CREDITO',
        origem: 'COMPRA',
        valorCentavos: 1_000,
        estado: 'PENDENTE',
        liberaEm: calcularLiberaEm(new Date('2026-03-11T03:30:00Z'), 7),
        chave: 'c1',
        criadoPor: 'teste',
        detalhes: { validadeDias: 30 },
      }),
    );
    amb.relogio.definir(new Date('2026-03-17T03:59:00Z')); // 16/03 23:59 Manaus
    expect((await livro.liberarPendentes()).liberados).toBe(0);
    amb.relogio.definir(new Date('2026-03-17T04:00:00Z')); // 17/03 00:00 Manaus
    expect((await livro.liberarPendentes()).liberados).toBe(1);
    const lote = await amb.prisma.lancamento.findFirstOrThrow({
      where: { chaveIdempotencia: 'c1' },
    });
    expect(lote.venceEm?.toISOString()).toBe('2026-04-17T03:59:59.999Z'); // 16/04 23:59:59 Manaus

    amb.relogio.definir(new Date('2026-04-17T03:45:00Z'));
    const reserva = await livro.reservar(
      {
        carteiraId,
        valorCompraCentavos: 3_000,
        valorCentavos: 600,
        lojaId: 'LOJA-01',
        chave: 'r1',
      },
      OPERADOR,
    );
    amb.relogio.definir(new Date('2026-04-17T04:00:00Z'));
    expect(await livro.vencerCreditos()).toEqual({ vencidos: 1, valorCentavos: 400 });
    // reserva feita antes do vencimento é honrada
    await livro.confirmarReserva(reserva.id, 'NF-2', OPERADOR);
    const final = await amb.prisma.lancamento.findUniqueOrThrow({ where: { id: lote.id } });
    expect(final.estado).toBe('RESGATADO');
    expect(await livro.restanteDoLote(amb.prisma, lote.id)).toBe(0);
  });

  it('FIFO por vencimento e ajuste negativo limitado ao saldo', async () => {
    await creditoDisponivel(500, 'tarde', new Date('2026-05-01T03:59:59.999Z'));
    const cedo = await creditoDisponivel(500, 'cedo', new Date('2026-04-01T03:59:59.999Z'));
    const reserva = await livro.reservar(
      {
        carteiraId,
        valorCompraCentavos: 10_000,
        valorCentavos: 600,
        lojaId: 'LOJA-01',
        chave: 'r1',
      },
      OPERADOR,
    );
    expect(reserva.alocacoes[0]).toMatchObject({ loteId: cedo.id, valorCentavos: 500 });
    expect(reserva.alocacoes[1].valorCentavos).toBe(100);
    await livro.cancelarReserva(reserva.id, 'cliente desistiu', OPERADOR);
    await expect(
      livro.ajusteManual(
        {
          carteiraId,
          valorCentavos: -1_001,
          motivo: 'estorno de lançamento duplicado',
          chave: 'a1',
        },
        SISTEMA,
      ),
    ).rejects.toMatchObject({ codigo: 'SALDO_INSUFICIENTE' });
    await livro.ajusteManual(
      { carteiraId, valorCentavos: -700, motivo: 'estorno de lançamento duplicado', chave: 'a2' },
      SISTEMA,
    );
    expect((await livro.resumo(carteiraId)).disponivelCentavos).toBe(300);
    const extrato = await livro.extrato(carteiraId);
    expect(extrato.itens.map((i) => i.origem)).toContain('AJUSTE_MANUAL');
  });

  it('carteira de prestador exige autenticação do titular para reservar', async () => {
    const pessoa = await amb.prisma.pessoa.create({
      data: { cpf: '11144477735', nome: 'João Prestador', telefone: '+5592992220000' },
    });
    const c = await amb.prisma.transacao((tx) =>
      livro.obterOuCriarCarteira(tx, 'PRESTADOR', { pessoaId: pessoa.id }),
    );
    await expect(
      livro.reservar(
        {
          carteiraId: c.id,
          valorCompraCentavos: 10_000,
          valorCentavos: 500,
          lojaId: 'LOJA-01',
          chave: 'p1',
        },
        OPERADOR,
      ),
    ).rejects.toMatchObject({ codigo: 'AUTENTICACAO_TITULAR' });
  });

  it('uma carteira por titular e tipo, mesmo com criação concorrente', async () => {
    const pessoa = await amb.prisma.pessoa.create({ data: { cpf: '39053344705', nome: 'Ana' } });
    const ids = await Promise.all(
      Array.from({ length: 5 }, () =>
        amb.prisma.transacao((tx) =>
          livro.obterOuCriarCarteira(tx, 'CLIENTE', { pessoaId: pessoa.id }),
        ),
      ),
    );
    expect(new Set(ids.map((c) => c.id)).size).toBe(1);
  });
});
