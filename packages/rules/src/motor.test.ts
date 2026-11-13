import { describe, expect, it } from 'vitest';
import { PERFIS_V1, PROGRAMA_V1 } from './seed-v1';
import {
  ErroConfiguracao,
  acumula,
  resolverConfiguracao,
  selecionarVersoesVigentes,
} from './configuracao';
import { aplicarBoasVindas, calcularVenda } from './calculo';
import { recalcularAposDevolucao } from './devolucao';
import {
  SaldoInsuficienteError,
  alocarFifo,
  avaliarResgate,
  calcularSaldos,
  distribuirEstorno,
  ordenarFifo,
} from './carteira';
import { calcularNivel, detectarPadroesSuspeitos, verificarAutoindicacao } from './antifraude';
import { avaliarPisosMargem } from './margem';
import { gerarRegrasEmLinguagemSimples } from './regras-texto';
import { AGORA, IMPLANTACAO, configV1, item, venda, versao, versoesV1 } from './testes/fixtures';

const cfg = configV1();

describe('configuração', () => {
  it('escolhe a versão de maior vigência e respeita vigência futura e fim', () => {
    const base = versao('FAMILIA', { cashbackBps: 100 }, { regraId: 'f', familia: 'A', versao: 1 });
    const v2 = { ...base, regraVersaoId: 'f2', versao: 2 };
    const futura = {
      ...base,
      regraVersaoId: 'f3',
      versao: 3,
      vigenciaInicio: new Date('2027-01-01'),
    };
    const encerrada = versao(
      'FAMILIA',
      { cashbackBps: 100 },
      { regraId: 'g', familia: 'B', vigenciaFim: new Date('2026-02-01') },
    );
    const sel = selecionarVersoesVigentes([base, v2, futura, encerrada], AGORA);
    expect(sel.map((v) => v.regraVersaoId)).toEqual(['f2']);
  });
  it('desativação versionada (ativa=false) remove a regra', () => {
    const v1 = versao('FAMILIA', { elegivel: false }, { regraId: 'x', familia: 'A' });
    const off = {
      ...v1,
      regraVersaoId: 'x2',
      versao: 2,
      vigenciaInicio: new Date('2026-02-01'),
      ativa: false,
    };
    expect(configV1([v1, off]).sobrescritas).toHaveLength(0);
    expect(configV1([v1, off], new Date('2026-01-15')).sobrescritas).toHaveLength(1);
  });
  it('falha sem regras obrigatórias, com duplicidade ou parâmetros inválidos', () => {
    expect(() => resolverConfiguracao([], AGORA)).toThrow(ErroConfiguracao);
    const semPrograma = versoesV1().filter((v) => v.escopo !== 'PROGRAMA');
    expect(() => resolverConfiguracao(semPrograma, AGORA)).toThrow(/PROGRAMA/);
    const dupla = [
      ...versoesV1(),
      versao('MATRIZ', { pares: [{ a: 'CASHBACK', b: 'PROMOCAO', acumula: true }] }),
    ];
    expect(() => resolverConfiguracao(dupla, AGORA)).toThrow(/mais de uma/);
    const invalida = [...versoesV1(), versao('FAMILIA', { cashbackBps: -1 }, { familia: 'Z' })];
    expect(() => resolverConfiguracao(invalida, AGORA)).toThrow(/parâmetros inválidos/);
    const semNivel = versoesV1().filter((v) => v.escopo !== 'NIVEL_PRESTADOR');
    expect(resolverConfiguracao(semNivel, AGORA).nivel).toBeNull();
  });
  it('matriz é simétrica e par ausente não acumula', () => {
    const m = cfg.matriz.parametros;
    expect(acumula(m, 'CASHBACK', 'TABELA_PROFISSIONAL')).toBe(false);
    expect(acumula(m, 'CASHBACK', 'INDICACAO')).toBe(true);
    expect(acumula(m, 'CASHBACK', 'CASHBACK')).toBe(true);
    expect(
      acumula(
        { pares: [{ a: 'CASHBACK', b: 'PROMOCAO', acumula: true }] },
        'INDICACAO',
        'PROMOCAO',
      ),
    ).toBe(false);
  });
});

describe('cálculo', () => {
  it('campanha vale entre família e loja/canal, e escolhe a de maior percentual', () => {
    const camp = versao(
      'CAMPANHA',
      { cashbackBps: 500, familias: ['FERRAMENTAS'] },
      { nome: 'Semana da Ferramenta' },
    );
    const camp2 = versao('CAMPANHA', {
      cashbackBps: 700,
      skus: ['SKU-9'],
      lojas: ['LOJA-01'],
      canais: ['LOJA'],
    });
    const loja = versao('LOJA_CANAL', { cashbackBps: 400 }, { lojaId: 'LOJA-01' });
    const r = calcularVenda(
      venda([
        item('1', 10_000, { familia: 'FERRAMENTAS' }),
        item('9', 10_000, { familia: 'FERRAMENTAS' }),
        item('3', 10_000, { familia: 'OUTRA' }),
      ]),
      configV1([camp, camp2, loja]),
    );
    expect(r.itens.map((i) => i.cashbackBps)).toEqual([500, 700, 400]);
    expect(r.cashback.origem).toBe('CAMPANHA');
  });
  it('campanha que não acumula com promoção cai para o próximo nível; filtros de loja/canal/perfil', () => {
    const camp = versao('CAMPANHA', { cashbackBps: 500, acumulaComPromocao: false });
    const outraLoja = versao('CAMPANHA', { cashbackBps: 900, lojas: ['LOJA-02'] });
    const outroCanal = versao('CAMPANHA', { cashbackBps: 900, canais: ['APP'] });
    const soPj = versao('CAMPANHA', { cashbackBps: 900 }, { perfil: 'CLIENTE_EMPRESA' });
    const r = calcularVenda(
      venda([item('1', 10_000, { emPromocao: true }), item('2', 10_000)]),
      configV1([camp, outraLoja, outroCanal, soPj]),
    );
    expect(r.itens.map((i) => i.cashbackBps)).toEqual([300, 500]);
  });
  it('loja+canal é mais específica que só loja ou só canal; regra sem loja e canal é ignorada', () => {
    const soCanal = versao('LOJA_CANAL', { cashbackBps: 100 }, { canal: 'LOJA' });
    const lojaCanal = versao(
      'LOJA_CANAL',
      { cashbackBps: 200 },
      { lojaId: 'LOJA-01', canal: 'LOJA' },
    );
    const soLoja = versao('LOJA_CANAL', { cashbackBps: 150 }, { lojaId: 'LOJA-01' });
    const vazia = versao('LOJA_CANAL', { cashbackBps: 999 });
    const r = calcularVenda(
      venda([item('1', 10_000)]),
      configV1([soCanal, soLoja, lojaCanal, vazia]),
    );
    expect(r.itens[0].cashbackBps).toBe(200);
  });
  it('subfamília sobrepõe família; sobrescrita só de indicação não altera cashback', () => {
    const fam = versao('FAMILIA', { cashbackBps: 100 }, { familia: 'GERAL' });
    const sub = versao('SUBFAMILIA', { cashbackBps: 250 }, { subfamilia: 'GERAL-01' });
    const skuInd = versao('PRODUTO', { indicacaoBps: 100 }, { sku: 'SKU-1' });
    const r = calcularVenda(
      venda([item('1', 10_000)], { indicacao: { nivel: 'OURO' } }),
      configV1([fam, sub, skuInd]),
    );
    expect(r.itens[0].cashbackBps).toBe(250);
    expect(r.itens[0].indicacaoBps).toBe(100);
  });
  it('matriz: tabela profissional, promoção e desconto negociado', () => {
    const matrizRestrita = versao(
      'MATRIZ',
      {
        pares: [
          { a: 'PROMOCAO', b: 'CASHBACK', acumula: false },
          { a: 'DESCONTO_NEGOCIADO', b: 'CASHBACK', acumula: false },
          { a: 'INDICACAO', b: 'CASHBACK', acumula: true },
          { a: 'PROMOCAO', b: 'INDICACAO', acumula: false },
          { a: 'DESCONTO_NEGOCIADO', b: 'INDICACAO', acumula: false },
        ],
      },
      {
        regraId: 'r-matriz',
        regraVersaoId: 'rv-matriz-2',
        versao: 2,
        vigenciaInicio: new Date('2026-02-01'),
      },
    );
    const c = configV1([matrizRestrita]);
    const r = calcularVenda(
      venda(
        [
          item('1', 10_000, { emPromocao: true }),
          item('2', 10_000, { descontoNegociado: true }),
          item('3', 10_000, { tabelaProfissional: true }),
          item('4', 10_000),
        ],
        { indicacao: { nivel: 'BRONZE' } },
      ),
      c,
    );
    expect(r.itens.map((i) => i.cashbackBps)).toEqual([0, 0, 0, 300]);
    expect(r.itens.map((i) => i.indicacaoBps)).toEqual([0, 0, 0, 300]);
  });
  it('indicação que não acumula com cashback zera o cashback do comprador', () => {
    const m = versao(
      'MATRIZ',
      { pares: [{ a: 'INDICACAO', b: 'CASHBACK', acumula: false }] },
      { regraId: 'r-matriz', regraVersaoId: 'rv-m3', versao: 3 },
    );
    const r = calcularVenda(
      venda([item('1', 10_000)], { indicacao: { nivel: 'BRONZE' } }),
      configV1([m]),
    );
    expect(r.cashback.valorCentavos).toBe(0);
    expect(r.cashback.motivoZero).toBe('SEM_ITENS_ELEGIVEIS');
    expect(r.indicacao.valorCentavos).toBe(300);
  });
  it('não elegível para indicação por família; elegivelIndicacao=false', () => {
    const fam = versao('FAMILIA', { elegivel: false }, { familia: 'CIMENTO' });
    const sub = versao('SUBFAMILIA', { elegivelIndicacao: false }, { subfamilia: 'TINTA-01' });
    const r = calcularVenda(
      venda(
        [item('1', 10_000, { familia: 'CIMENTO' }), item('2', 10_000, { subfamilia: 'TINTA-01' })],
        { indicacao: { nivel: 'PRATA' } },
      ),
      configV1([fam, sub]),
    );
    expect(r.itens.map((i) => i.indicacaoBps)).toEqual([0, 0]);
    expect(r.indicacao.motivoZero).toBe('SEM_ITENS_ELEGIVEIS');
  });
  it('não participante não gera cashback mas gera indicação; mínimo de indicação', () => {
    const r = calcularVenda(
      venda([item('1', 20_000)], { compradorParticipante: false, indicacao: { nivel: 'BRONZE' } }),
      cfg,
    );
    expect(r.cashback).toMatchObject({ valorCentavos: 0, motivoZero: 'NAO_PARTICIPANTE' });
    expect(r.indicacao.valorCentavos).toBe(600);
    const baixa = calcularVenda(venda([item('1', 4_000)], { indicacao: { nivel: 'BRONZE' } }), cfg);
    expect(baixa.indicacao.motivoZero).toBe('ABAIXO_MINIMO');
  });
  it('boas-vindas respeita teto e não dobra item não elegível', () => {
    expect(aplicarBoasVindas(300, 200, 600)).toBe(600);
    expect(aplicarBoasVindas(500, 200, 600)).toBe(600);
    expect(aplicarBoasVindas(700, 200, 600)).toBe(700);
    expect(aplicarBoasVindas(0, 200, 600)).toBe(0);
    const fam = versao('FAMILIA', { cashbackBps: 100 }, { familia: 'BAIXA' });
    const r = calcularVenda(
      venda([item('1', 10_000, { familia: 'BAIXA' })], { boasVindas: true }),
      configV1([fam]),
    );
    expect(r.itens[0].cashbackBps).toBe(200);
  });
  it('empresa usa o próprio perfil; cashback maior que a venda é limitado; arredonda para baixo uma vez', () => {
    const r = calcularVenda(
      venda([item('1', 3_333), item('2', 3_333), item('3', 3_334)], {
        perfil: 'CLIENTE_EMPRESA',
        pagoComCashbackCentavos: 999_999,
      }),
      cfg,
    );
    expect(r.pagoComCashbackConsideradoCentavos).toBe(10_000);
    expect(r.cashback.valorCentavos).toBe(0);
    const f = calcularVenda(venda([item('1', 6_666), item('2', 6_667)]), cfg);
    expect(f.cashback.valorCentavos).toBe(399); // 399,99 → 399
    expect(f.cashback.brutoDecimilesimos).toBe('3999900');
  });
  it('venda só com serviço/frete e validações de entrada', () => {
    const r = calcularVenda(venda([item('S', 50_000, { tipo: 'SERVICO' })]), cfg);
    expect(r.baseCalculoCentavos).toBe(0);
    expect(() => calcularVenda(venda([item('1', 100, { descontoCentavos: 200 })]), cfg)).toThrow();
    expect(() => calcularVenda(venda([item('1', 10.5)]), cfg)).toThrow();
    expect(() =>
      calcularVenda(venda([item('1', 100)], { pagoComCashbackCentavos: -1 }), cfg),
    ).toThrow();
  });
});

describe('devolução', () => {
  const original = calcularVenda(
    venda([item('1', 10_000), item('2', 10_000), item('F', 2_000, { tipo: 'FRETE' })], {
      pagoComCashbackCentavos: 2_000,
      indicacao: { nivel: 'BRONZE' },
    }),
    cfg,
  );
  it('devolve parcela de cashback usado e respeita o concedido', () => {
    expect(original.cashback.valorCentavos).toBe(540);
    const r = recalcularAposDevolucao(original, {
      devolvidoPorItem: { '1': 5_000, F: 2_000 },
      aplicarCompraMinima: true,
      cashbackConcedidoCentavos: 540,
      recompensaConcedidaCentavos: 100,
    });
    expect(r.cashbackUtilizadoDevolvidoCentavos).toBe(500);
    expect(r.cashbackDevidoCentavos).toBe(405);
    expect(r.recompensaDevidaCentavos).toBe(100); // limitado ao que foi concedido (teto)
  });
  it('abaixo do mínimo após devolução zera (configurável)', () => {
    const tudo = { '1': 10_000, '2': 6_000 };
    const comMin = recalcularAposDevolucao(original, {
      devolvidoPorItem: tudo,
      aplicarCompraMinima: true,
      cashbackConcedidoCentavos: 540,
      recompensaConcedidaCentavos: 540,
    });
    expect([comMin.cashbackDevidoCentavos, comMin.recompensaDevidaCentavos]).toEqual([0, 0]);
    const semMin = recalcularAposDevolucao(original, {
      devolvidoPorItem: tudo,
      aplicarCompraMinima: false,
      cashbackConcedidoCentavos: 540,
      recompensaConcedidaCentavos: 540,
    });
    expect(semMin.cashbackDevidoCentavos).toBe(108);
  });
  it('devolvido acima do líquido é limitado', () => {
    const r = recalcularAposDevolucao(original, {
      devolvidoPorItem: { '1': 99_999, '2': -5 },
      aplicarCompraMinima: false,
      cashbackConcedidoCentavos: 540,
      recompensaConcedidaCentavos: 540,
    });
    expect(r.itens[0].devolvidoCentavos).toBe(10_000);
    expect(r.itens[1].devolvidoCentavos).toBe(0);
  });
});

describe('carteira', () => {
  it('FIFO por vencimento, depois por ordem de criação', () => {
    const lotes = [
      { id: 'B', venceEm: new Date('2026-05-01'), seq: 1, livreCentavos: 500 },
      { id: 'A', venceEm: new Date('2026-04-01'), seq: 2, livreCentavos: 300 },
      { id: 'C', venceEm: new Date('2026-04-01'), seq: 3, livreCentavos: 300 },
      { id: 'Z', venceEm: new Date('2026-03-01'), seq: 4, livreCentavos: 0 },
    ];
    expect(ordenarFifo(lotes).map((l) => l.id)).toEqual(['Z', 'A', 'C', 'B']);
    expect(alocarFifo(lotes, 700)).toEqual([
      { loteId: 'A', valorCentavos: 300 },
      { loteId: 'C', valorCentavos: 300 },
      { loteId: 'B', valorCentavos: 100 },
    ]);
    expect(() => alocarFifo(lotes, 0)).toThrow();
    expect(() => alocarFifo(lotes, 2_000)).toThrow(SaldoInsuficienteError);
  });
  it('avaliação de resgate: compra sem valor, valor inválido, acima do saldo', () => {
    const p = PROGRAMA_V1.carteiras.CLIENTE;
    expect(
      avaliarResgate({
        saldoDisponivelCentavos: 1_000,
        saldoDevedorCentavos: 0,
        valorCompraCentavos: 0,
        parametros: p,
      }).motivo,
    ).toBe('COMPRA_SEM_VALOR');
    expect(
      avaliarResgate({
        saldoDisponivelCentavos: 1_000,
        saldoDevedorCentavos: 0,
        valorCompraCentavos: 100_000,
        valorSolicitadoCentavos: 0,
        parametros: p,
      }).motivo,
    ).toBe('VALOR_INVALIDO');
    expect(
      avaliarResgate({
        saldoDisponivelCentavos: 1_000,
        saldoDevedorCentavos: 0,
        valorCompraCentavos: 100_000,
        valorSolicitadoCentavos: 1_001,
        parametros: p,
      }).motivo,
    ).toBe('VALOR_ACIMA_DO_SALDO');
  });
  it('estorno: livre → vencido → devedor', () => {
    expect(
      distribuirEstorno({
        valorEstornoCentavos: 1_000,
        livreNoLoteCentavos: 200,
        vencidoDoLoteCentavos: 300,
      }),
    ).toEqual({
      estornarDoLoteCentavos: 200,
      absorvidoPorVencimentoCentavos: 300,
      saldoDevedorCentavos: 500,
    });
  });
  it('saldos: pendente, vencido segura só o reservado, próximo vencimento agrupa', () => {
    const s = calcularSaldos({
      lotes: [
        {
          id: 'P',
          estado: 'PENDENTE',
          seq: 1,
          venceEm: null,
          liberaEm: new Date('2026-03-15'),
          restanteCentavos: 700,
        },
        {
          id: 'V',
          estado: 'DISPONIVEL',
          seq: 2,
          venceEm: new Date('2026-03-01'),
          liberaEm: null,
          restanteCentavos: 400,
        },
        {
          id: 'A',
          estado: 'DISPONIVEL',
          seq: 3,
          venceEm: new Date('2026-04-01'),
          liberaEm: null,
          restanteCentavos: 300,
        },
        {
          id: 'B',
          estado: 'DISPONIVEL',
          seq: 4,
          venceEm: new Date('2026-04-01'),
          liberaEm: null,
          restanteCentavos: 200,
        },
        {
          id: 'R',
          estado: 'RESGATADO',
          seq: 5,
          venceEm: new Date('2026-04-01'),
          liberaEm: null,
          restanteCentavos: 0,
        },
      ],
      reservasAtivas: [
        {
          id: 'X',
          expiraEm: new Date('2026-03-10T16:00:00Z'),
          alocacoes: [{ loteId: 'V', valorCentavos: 100 }],
        },
      ],
      semLoteCentavos: 50,
      agora: AGORA,
    });
    expect(s).toMatchObject({
      pendenteCentavos: 700,
      reservadoCentavos: 100,
      disponivelCentavos: 500,
      devedorCentavos: 0,
    });
    expect(s.proximoVencimento).toEqual({ venceEm: new Date('2026-04-01'), valorCentavos: 500 });
    expect(
      calcularSaldos({ lotes: [], reservasAtivas: [], semLoteCentavos: 0, agora: AGORA })
        .proximoVencimento,
    ).toBeNull();
  });
});

describe('antifraude e níveis', () => {
  const af = PROGRAMA_V1.antifraude;
  it('autoindicação por CNPJ e telefone; indicação legítima passa', () => {
    expect(
      verificarAutoindicacao({
        comprador: {
          cpfs: ['11144477735'],
          cnpj: '11.222.333/0001-81',
          telefones: ['(92) 99111-0000'],
        },
        prestador: {
          cpfTitular: '52998224725',
          cnpj: '11222333000181',
          telefones: ['+5592991110000'],
        },
      }).motivos,
    ).toEqual(['MESMO_CNPJ', 'MESMO_TELEFONE']);
    expect(
      verificarAutoindicacao({
        comprador: { cpfs: ['11144477735'], telefones: ['invalido'] },
        prestador: { cpfTitular: '52998224725', telefones: [] },
      }).bloqueada,
    ).toBe(false);
  });
  it('detecta comprador repetido, valores redondos e muitas canceladas', () => {
    const vendas = Array.from({ length: 10 }, (_, i) => ({
      vendaId: `v${i}`,
      compradorChave: 'C1',
      valorCentavos: 50_000,
      instante: new Date(AGORA.getTime() - i * 86_400_000),
      cancelada: i < 5,
    }));
    const antiga = {
      vendaId: 'old',
      compradorChave: 'C2',
      valorCentavos: 100,
      instante: new Date('2025-01-01'),
      cancelada: false,
    };
    const tipos = detectarPadroesSuspeitos([...vendas, antiga], af, AGORA).map((a) => a.tipo);
    expect(tipos).toEqual(['COMPRADOR_REPETIDO', 'VALORES_REDONDOS', 'MUITAS_CANCELADAS']);
    expect(detectarPadroesSuspeitos(vendas.slice(0, 2), af, AGORA)).toEqual([]);
  });
  it('nível pelos critérios', () => {
    const p = configV1().nivel!.parametros;
    expect(calcularNivel(p, { volumeIndicadoCentavos: 6_000_000, vendasIndicadas: 30 })).toBe(
      'OURO',
    );
    expect(calcularNivel(p, { volumeIndicadoCentavos: 6_000_000, vendasIndicadas: 12 })).toBe(
      'PRATA',
    );
    expect(calcularNivel(p, { volumeIndicadoCentavos: 0, vendasIndicadas: 0 })).toBe('BRONZE');
    expect(
      calcularNivel({ ...p, criterios: [] }, { volumeIndicadoCentavos: 0, vendasIndicadas: 0 }),
    ).toBe('BRONZE');
  });
});

describe('piso de margem (alerta)', () => {
  it('alerta concessão acima do piso e margem abaixo do mínimo', () => {
    const pisoConc = versao('PISO_MARGEM', { concessaoMaximaBps: 500 }, { familia: 'CIMENTO' });
    const pisoMarg = versao('PISO_MARGEM', { margemMinimaBps: 1_500 }, { familia: 'FERRO' });
    const c = configV1([pisoConc, pisoMarg]);
    const r = calcularVenda(
      venda(
        [
          item('1', 10_000, { familia: 'CIMENTO', descontoCentavos: 400 }),
          item('2', 10_000, { familia: 'FERRO', custoCentavos: 8_500 }),
          item('3', 10_000, { familia: 'SEM_PISO' }),
          item('4', 10_000, { familia: 'FERRO', tipo: 'SERVICO' }),
        ],
        { indicacao: { nivel: 'BRONZE' } },
      ),
      c,
    );
    const alertas = avaliarPisosMargem(r, c);
    expect(alertas.map((a) => [a.familia, a.motivo])).toEqual([
      ['CIMENTO', 'CONCESSAO_ACIMA_DO_PISO'],
      ['FERRO', 'MARGEM_ABAIXO_DO_PISO'],
    ]);
    expect(avaliarPisosMargem(r, configV1())).toEqual([]);
    const semCredito = calcularVenda(
      venda([item('1', 10_000, { familia: 'CIMENTO', descontoCentavos: 100 })], {
        compradorParticipante: false,
      }),
      c,
    );
    expect(avaliarPisosMargem(semCredito, c)).toEqual([]);
    const zerado = calcularVenda(venda([item('1', 0, { familia: 'CIMENTO' })]), c);
    expect(avaliarPisosMargem(zerado, c)).toEqual([]);
  });
});

describe('regras em linguagem simples', () => {
  it('gera texto a partir da configuração vigente', () => {
    const secoes = gerarRegrasEmLinguagemSimples(cfg);
    const texto = JSON.stringify(secoes);
    expect(texto).toContain('3% de volta');
    expect(texto).toContain('R$ 50,00');
    expect(texto).toContain('7 dias');
    expect(texto).toContain('R$ 1.000,00');
    const semBv = configV1([
      versao(
        'PERFIL',
        { ...PERFIS_V1.CLIENTE_CPF, boasVindas: null },
        {
          perfil: 'CLIENTE_CPF',
          regraId: 'r-perfil-CLIENTE_CPF',
          regraVersaoId: 'x',
          versao: 9,
          vigenciaInicio: IMPLANTACAO,
        },
      ),
    ]);
    expect(JSON.stringify(gerarRegrasEmLinguagemSimples(semBv))).not.toContain('Boas-vindas');
  });
});
