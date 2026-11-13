/**
 * Cenários de aceite da seção 11 do escopo (parte pura: motor de regras + regras do livro-razão).
 * Os cenários que dependem de banco (concorrência, idempotência de importação, expiração de reserva
 * com saldo real) também são cobertos em apps/api/test/aceite-livro-razao.e2e.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { calcularLiberaEm, calcularVenceEm, mesCivilLocal, somarMinutos } from '@cdc/shared';
import { calcularVenda } from './calculo';
import { resolverConfiguracao } from './configuracao';
import { recalcularAposDevolucao } from './devolucao';
import {
  SaldoInsuficienteError,
  alocarFifo,
  aplicarTetoMensal,
  avaliarResgate,
  calcularSaldos,
  distribuirEstorno,
  validarAjusteManual,
} from './carteira';
import { verificarAutoindicacao } from './antifraude';
import { PERFIS_V1 } from './seed-v1';
import { AGORA, configV1, item, venda, versao, versoesV1 } from './testes/fixtures';

const cfg = configV1();
const paramsCliente = cfg.programa.parametros.carteiras.CLIENTE;

describe('Seção 11 — cenários de aceite', () => {
  it('01. compra de R$ 200 (CPF) → crédito pendente de R$ 6,00; libera em 7 dias; vence 30 dias depois', () => {
    const r = calcularVenda(venda([item('1', 20_000)]), cfg);
    expect(r.cashback.valorCentavos).toBe(600);
    expect(r.cashback.origem).toBe('COMPRA');
    const liberaEm = calcularLiberaEm(AGORA, paramsCliente.carenciaDias);
    expect(liberaEm.toISOString()).toBe('2026-03-17T04:00:00.000Z'); // 17/03 00:00 Manaus
    const venceEm = calcularVenceEm(liberaEm, paramsCliente.validadeDias);
    expect(venceEm.toISOString()).toBe('2026-04-17T03:59:59.999Z'); // 16/04 23:59:59 Manaus
  });

  it('02. primeira compra após a adesão → 6% (boas-vindas)', () => {
    const r = calcularVenda(venda([item('1', 20_000)], { boasVindas: true }), cfg);
    expect(r.cashback.valorCentavos).toBe(1_200);
    expect(r.cashback.origem).toBe('BOAS_VINDAS');
    expect(r.cashback.boasVindasAplicada).toBe(true);
    expect(r.itens[0].cashbackBps).toBe(600);
  });

  it('03. compra de R$ 49,99 → nenhum crédito (e R$ 50,00 gera)', () => {
    const r = calcularVenda(venda([item('1', 4_999)]), cfg);
    expect(r.cashback.valorCentavos).toBe(0);
    expect(r.cashback.motivoZero).toBe('ABAIXO_MINIMO');
    expect(calcularVenda(venda([item('1', 5_000)]), cfg).cashback.valorCentavos).toBe(150);
  });

  it('04. compra paga parcialmente com cashback → a parcela paga com cashback não gera crédito', () => {
    const r = calcularVenda(
      venda([item('1', 15_000), item('2', 5_000)], { pagoComCashbackCentavos: 4_000 }),
      cfg,
    );
    expect(r.baseCalculoCentavos).toBe(16_000);
    expect(r.cashback.valorCentavos).toBe(480);
    expect(r.itens.map((i) => i.cashbackUtilizadoCentavos)).toEqual([3_000, 1_000]);
  });

  it('05. frete e serviços ficam fora da base (descontos já abatidos)', () => {
    const r = calcularVenda(
      venda([
        item('1', 22_000, { descontoCentavos: 2_000 }),
        item('F', 3_000, { tipo: 'FRETE' }),
        item('S', 5_000, { tipo: 'SERVICO' }),
      ]),
      cfg,
    );
    expect(r.baseCalculoCentavos).toBe(20_000);
    expect(r.excluidoFreteServicosCentavos).toBe(8_000);
    expect(r.cashback.valorCentavos).toBe(600);
  });

  it('06. resgate limitado a 20% da nova compra e saldo mínimo de R$ 5', () => {
    const ok = avaliarResgate({
      saldoDisponivelCentavos: 10_000,
      saldoDevedorCentavos: 0,
      valorCompraCentavos: 20_000,
      parametros: paramsCliente,
    });
    expect(ok.permitido).toBe(true);
    expect(ok.limitePorCompraCentavos).toBe(4_000);
    expect(ok.maximoResgatavelCentavos).toBe(4_000);
    const acima = avaliarResgate({
      saldoDisponivelCentavos: 10_000,
      saldoDevedorCentavos: 0,
      valorCompraCentavos: 20_000,
      valorSolicitadoCentavos: 4_001,
      parametros: paramsCliente,
    });
    expect(acima).toMatchObject({ permitido: false, motivo: 'VALOR_ACIMA_DO_LIMITE' });
    const minimo = avaliarResgate({
      saldoDisponivelCentavos: 499,
      saldoDevedorCentavos: 0,
      valorCompraCentavos: 20_000,
      parametros: paramsCliente,
    });
    expect(minimo).toMatchObject({
      permitido: false,
      motivo: 'SALDO_ABAIXO_MINIMO',
      maximoResgatavelCentavos: 0,
    });
    const exato = avaliarResgate({
      saldoDisponivelCentavos: 500,
      saldoDevedorCentavos: 0,
      valorCompraCentavos: 20_000,
      valorSolicitadoCentavos: 500,
      parametros: paramsCliente,
    });
    expect(exato.permitido).toBe(true);
  });

  it('07. duas reservas do mesmo saldo → só uma é aceita (regra pura; concorrência real testada na API)', () => {
    const lotes = [{ id: 'L1', venceEm: new Date('2026-04-01'), seq: 1, livreCentavos: 1_000 }];
    const primeira = alocarFifo(lotes, 1_000);
    expect(primeira).toEqual([{ loteId: 'L1', valorCentavos: 1_000 }]);
    const saldos = calcularSaldos({
      lotes: [
        {
          id: 'L1',
          estado: 'DISPONIVEL',
          seq: 1,
          venceEm: new Date('2026-04-01'),
          liberaEm: null,
          restanteCentavos: 1_000,
        },
      ],
      reservasAtivas: [{ id: 'R1', expiraEm: somarMinutos(AGORA, 30), alocacoes: primeira }],
      semLoteCentavos: 0,
      agora: AGORA,
    });
    expect(saldos.disponivelCentavos).toBe(0);
    expect(() => alocarFifo(saldos.lotesLivres, 1_000)).toThrow(SaldoInsuficienteError);
  });

  it('08. mesma venda calculada duas vezes → resultado idêntico (idempotência do cálculo)', () => {
    const v = venda([item('1', 20_000), item('2', 7_777)]);
    expect(calcularVenda(v, cfg)).toEqual(calcularVenda(v, cfg));
  });

  it('09. devolução parcial antes do uso → estorno proporcional', () => {
    const original = calcularVenda(venda([item('1', 10_000), item('2', 10_000)]), cfg);
    expect(original.cashback.valorCentavos).toBe(600);
    const rec = recalcularAposDevolucao(original, {
      devolvidoPorItem: { '1': 10_000 },
      aplicarCompraMinima: true,
      cashbackConcedidoCentavos: 600,
      recompensaConcedidaCentavos: 0,
    });
    expect(rec.cashbackDevidoCentavos).toBe(300);
    const estorno = 600 - rec.cashbackDevidoCentavos;
    expect(
      distribuirEstorno({
        valorEstornoCentavos: estorno,
        livreNoLoteCentavos: 600,
        vencidoDoLoteCentavos: 0,
      }),
    ).toEqual({
      estornarDoLoteCentavos: 300,
      absorvidoPorVencimentoCentavos: 0,
      saldoDevedorCentavos: 0,
    });
  });

  it('10. devolução após o crédito já ter sido usado → saldo devedor e bloqueio de resgate até zerar', () => {
    const d = distribuirEstorno({
      valorEstornoCentavos: 600,
      livreNoLoteCentavos: 0,
      vencidoDoLoteCentavos: 0,
    });
    expect(d.saldoDevedorCentavos).toBe(600);
    const bloqueio = avaliarResgate({
      saldoDisponivelCentavos: 10_000,
      saldoDevedorCentavos: 600,
      valorCompraCentavos: 50_000,
      parametros: paramsCliente,
    });
    expect(bloqueio).toMatchObject({
      permitido: false,
      motivo: 'SALDO_DEVEDOR',
      maximoResgatavelCentavos: 0,
    });
    const saldos = calcularSaldos({
      lotes: [],
      reservasAtivas: [],
      semLoteCentavos: -600,
      agora: AGORA,
    });
    expect(saldos.devedorCentavos).toBe(600);
  });

  it('11. venda indicada por prestador Bronze → comprador 3% e prestador 3%', () => {
    const r = calcularVenda(venda([item('1', 20_000)], { indicacao: { nivel: 'BRONZE' } }), cfg);
    expect(r.cashback.valorCentavos).toBe(600);
    expect(r.indicacao.valorCentavos).toBe(600);
    expect(r.indicacao.nivel).toBe('BRONZE');
    const prata = calcularVenda(venda([item('1', 20_000)], { indicacao: { nivel: 'PRATA' } }), cfg);
    const ouro = calcularVenda(venda([item('1', 20_000)], { indicacao: { nivel: 'OURO' } }), cfg);
    expect([prata.indicacao.valorCentavos, ouro.indicacao.valorCentavos]).toEqual([800, 1_000]);
  });

  it('12. autoindicação → recompensa bloqueada (e motivo para o alerta)', () => {
    const verif = verificarAutoindicacao({
      comprador: { cpfs: ['529.982.247-25'], telefones: ['(92) 99111-0000'] },
      prestador: { cpfTitular: '52998224725', telefones: ['92 99222-0000'] },
    });
    expect(verif).toEqual({ bloqueada: true, motivos: ['MESMO_CPF'] });
    const r = calcularVenda(
      venda([item('1', 20_000)], {
        indicacao: { nivel: 'BRONZE', bloqueio: 'AUTOINDICACAO:MESMO_CPF' },
      }),
      cfg,
    );
    expect(r.indicacao.valorCentavos).toBe(0);
    expect(r.indicacao.motivoZero).toBe('BLOQUEADA');
    expect(r.cashback.valorCentavos).toBe(600); // comprador não é penalizado
  });

  it('13. teto mensal de R$ 1.000 atingido → excedente não gerado e registrado', () => {
    const teto = cfg.programa.parametros.indicacao.tetoMensalCentavos;
    expect(teto).toBe(100_000);
    expect(
      aplicarTetoMensal({
        valorCalculadoCentavos: 2_500,
        jaConcedidoNoMesCentavos: 99_000,
        tetoMensalCentavos: teto,
      }),
    ).toEqual({
      concedidoCentavos: 1_000,
      excedenteCentavos: 1_500,
    });
    expect(
      aplicarTetoMensal({
        valorCalculadoCentavos: 500,
        jaConcedidoNoMesCentavos: 100_000,
        tetoMensalCentavos: teto,
      }),
    ).toEqual({
      concedidoCentavos: 0,
      excedenteCentavos: 500,
    });
  });

  it('14. prestador comprando para si → tabela meio de campo e nenhum cashback', () => {
    const skuPromo = versao('PRODUTO', { cashbackBps: 900 }, { sku: 'SKU-1' });
    const r = calcularVenda(
      venda([item('1', 50_000, { tabelaProfissional: true })], { perfil: 'PRESTADOR' }),
      configV1([skuPromo]),
    );
    expect(r.cashback.valorCentavos).toBe(0);
    expect(r.cashback.motivoZero).toBe('PERFIL_SEM_CASHBACK');
    expect(r.itens[0].cashbackBps).toBe(0);
  });

  it('15. família não elegível → 0% sem afetar os demais itens', () => {
    const naoElegivel = versao('FAMILIA', { elegivel: false }, { familia: 'CIMENTO' });
    const r = calcularVenda(
      venda([
        item('1', 10_000, { familia: 'CIMENTO' }),
        item('2', 10_000, { familia: 'FERRAMENTAS' }),
      ]),
      configV1([naoElegivel]),
    );
    expect(r.itens.map((i) => i.cashbackBps)).toEqual([0, 300]);
    expect(r.cashback.valorCentavos).toBe(300);
    expect(r.itens[0].cashbackFonte.escopo).toBe('FAMILIA');
  });

  it('16. regra de SKU sobrepõe regra de família, que sobrepõe a regra geral', () => {
    const fam = versao('FAMILIA', { cashbackBps: 200 }, { familia: 'ELETRICA' });
    const sku = versao('PRODUTO', { cashbackBps: 500 }, { sku: 'CABO-10MM' });
    const r = calcularVenda(
      venda([
        item('1', 10_000, { familia: 'ELETRICA', sku: 'CABO-10MM' }),
        item('2', 10_000, { familia: 'ELETRICA', sku: 'DISJUNTOR' }),
        item('3', 10_000, { familia: 'HIDRAULICA', sku: 'TUBO' }),
      ]),
      configV1([fam, sku]),
    );
    expect(r.itens.map((i) => [i.cashbackBps, i.cashbackFonte.escopo])).toEqual([
      [500, 'PRODUTO'],
      [200, 'FAMILIA'],
      [300, 'PERFIL'],
    ]);
    expect(r.cashback.valorCentavos).toBe(1_000);
  });

  it('17. alteração de regra cria nova versão; cálculos antigos mantêm a versão original', () => {
    const v2 = versao(
      'PERFIL',
      { ...PERFIS_V1.CLIENTE_CPF, cashbackBps: 400 },
      {
        perfil: 'CLIENTE_CPF',
        regraId: 'r-perfil-CLIENTE_CPF',
        regraVersaoId: 'rv-perfil-CLIENTE_CPF-2',
        versao: 2,
        vigenciaInicio: new Date('2026-04-01T04:00:00Z'),
      },
    );
    const todas = [...versoesV1(), v2];
    const marco = calcularVenda(venda([item('1', 20_000)]), resolverConfiguracao(todas, AGORA));
    const abril = calcularVenda(
      venda([item('1', 20_000)], { instante: new Date('2026-04-02T15:00:00Z') }),
      resolverConfiguracao(todas, new Date('2026-04-02T15:00:00Z')),
    );
    expect([marco.cashback.valorCentavos, marco.regraVersaoPerfilId]).toEqual([
      600,
      'rv-perfil-CLIENTE_CPF-1',
    ]);
    expect([abril.cashback.valorCentavos, abril.regraVersaoPerfilId]).toEqual([
      800,
      'rv-perfil-CLIENTE_CPF-2',
    ]);
    // devolução de venda de março, já com v2 vigente, usa os percentuais gravados (3%)
    const rec = recalcularAposDevolucao(marco, {
      devolvidoPorItem: { '1': 10_000 },
      aplicarCompraMinima: true,
      cashbackConcedidoCentavos: 600,
      recompensaConcedidaCentavos: 0,
    });
    expect(rec.cashbackDevidoCentavos).toBe(300);
  });

  it('18. reserva não confirmada expira em 30 min e libera o saldo', () => {
    const ttl = cfg.programa.parametros.reservaTtlMinutos;
    expect(ttl).toBe(30);
    const criadaEm = AGORA;
    const reserva = {
      id: 'R1',
      expiraEm: somarMinutos(criadaEm, ttl),
      alocacoes: [{ loteId: 'L1', valorCentavos: 800 }],
    };
    const lotes = [
      {
        id: 'L1',
        estado: 'DISPONIVEL' as const,
        seq: 1,
        venceEm: new Date('2026-04-01'),
        liberaEm: null,
        restanteCentavos: 1_000,
      },
    ];
    const antes = calcularSaldos({
      lotes,
      reservasAtivas: [reserva],
      semLoteCentavos: 0,
      agora: somarMinutos(criadaEm, 29),
    });
    expect([antes.disponivelCentavos, antes.reservadoCentavos]).toEqual([200, 800]);
    const depois = calcularSaldos({
      lotes,
      reservasAtivas: [reserva],
      semLoteCentavos: 0,
      agora: somarMinutos(criadaEm, 30),
    });
    expect([depois.disponivelCentavos, depois.reservadoCentavos]).toEqual([1_000, 0]);
  });

  it('19. carência, vencimento e teto mensal calculados no fuso America/Manaus', () => {
    // 31/03 23:30 em Manaus = 01/04 03:30Z
    const confirmacao = new Date('2026-04-01T03:30:00Z');
    expect(mesCivilLocal(confirmacao)).toBe('2026-03');
    const libera = calcularLiberaEm(confirmacao, 7);
    expect(libera.toISOString()).toBe('2026-04-07T04:00:00.000Z'); // 07/04 00:00 Manaus (não 08/04)
    expect(calcularVenceEm(libera, 30).toISOString()).toBe('2026-05-08T03:59:59.999Z'); // 07/05 23:59:59 Manaus
  });

  it('20. ajuste manual sem motivo → rejeitado', () => {
    expect(validarAjusteManual({ valorCentavos: 1_000, motivo: '' })).toMatchObject({
      valido: false,
    });
    expect(validarAjusteManual({ valorCentavos: 1_000 })).toMatchObject({ valido: false });
    expect(validarAjusteManual({ valorCentavos: 1_000, motivo: 'ok' })).toMatchObject({
      valido: false,
    });
    expect(
      validarAjusteManual({ valorCentavos: 0, motivo: 'motivo suficientemente longo' }),
    ).toMatchObject({ valido: false });
    expect(
      validarAjusteManual({ valorCentavos: -500, motivo: 'correção de lançamento em duplicidade' }),
    ).toEqual({ valido: true });
  });
});
