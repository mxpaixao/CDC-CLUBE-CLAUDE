/**
 * Fluxo ponta a ponta pela API HTTP: adesão com OTP → importação de vendas → carência → caixa →
 * conciliação → devolução → prestador/indicação → regras versionadas → LGPD.
 * Cobre os cenários 1, 2, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15, 16 e 17 da seção 11 pela API.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gerarCpfValido } from '@cdc/shared';
import { ProvedorConsole } from '../src/notificacoes/provedores';
import { type Ambiente, criarAmbiente } from './ambiente';

const CPF_MARIA = '52998224725';
const CPF_JOAO = '11144477735'; // prestador
const CPF_ANA = gerarCpfValido('390533447');

const COLUNAS = [
  'tipo_movimento',
  'loja',
  'documento',
  'documento_origem',
  'data',
  'canal',
  'comprador_documento',
  'codigo_indicacao',
  'tabela_preco',
  'item',
  'sku',
  'descricao',
  'familia',
  'subfamilia',
  'tipo_item',
  'quantidade',
  'valor_bruto',
  'desconto',
  'frete',
  'pago_cashback',
  'codigo_resgate',
];
type Linha = Partial<Record<(typeof COLUNAS)[number], string>>;
function csv(linhas: Linha[]) {
  return Buffer.from(
    [COLUNAS.join(';'), ...linhas.map((l) => COLUNAS.map((c) => l[c] ?? '').join(';'))].join('\n'),
  );
}
function venda(
  doc: string,
  comprador: string,
  itens: {
    item: string;
    sku: string;
    valor: string;
    familia?: string;
    tipo?: string;
    desconto?: string;
  }[],
  extra: Linha = {},
): Linha[] {
  return itens.map((i) => ({
    tipo_movimento: 'VENDA',
    loja: '01',
    documento: doc,
    data: '10/03/2026 14:00',
    canal: 'LOJA',
    comprador_documento: comprador,
    item: i.item,
    sku: i.sku,
    descricao: `Produto ${i.sku}`,
    familia: i.familia ?? 'FERRAMENTAS',
    subfamilia: `${i.familia ?? 'FERRAMENTAS'}-01`,
    tipo_item: i.tipo ?? 'MERCADORIA',
    quantidade: '1',
    valor_bruto: i.valor,
    desconto: i.desconto ?? '0',
    ...extra,
  }));
}

let amb: Ambiente;
const admin = () => ({ Authorization: `Bearer ${amb.tokenAdmin}` });
const importar = async (nome: string, linhas: Linha[]) => {
  const r = await amb.http().post('/importacoes').set(admin()).attach('arquivo', csv(linhas), nome);
  expect(r.status).toBe(201);
  return r.body;
};
async function aderir(cpf: string, nome: string, telefone: string, consent = true) {
  const otp = await amb.http().post('/participantes/adesao/otp').send({ cpf, telefone });
  expect(otp.status).toBe(201);
  const codigo = /(\d{6})/.exec(
    ProvedorConsole.ultimaPara(otp.body.enviadoPara ? `+55${telefone.replace(/\D/g, '')}` : '')
      ?.texto ?? '',
  )?.[1];
  expect(codigo).toBeTruthy();
  const r = await amb
    .http()
    .post('/participantes/adesao')
    .send({
      tipo: 'CPF',
      cpf,
      nome,
      codigo,
      consentimentos: { ADESAO_PROGRAMA: true, MARKETING_WHATSAPP: consent },
    });
  expect(r.status).toBe(201);
  return r.body as { token: string; pessoa: { id: string } };
}
async function carteiraCliente(token: string) {
  const r = await amb.http().get('/app/inicio').set('Authorization', `Bearer ${token}`);
  return r.body.carteiras.find((c: { tipo: string }) => c.tipo === 'CLIENTE');
}

let maria: { token: string; pessoa: { id: string } };
let joao: { token: string; pessoa: { id: string } };
let prestadorId: string;
let codigoPrestador: string;

beforeAll(async () => {
  amb = await criarAmbiente(new Date('2026-03-10T15:00:00Z')); // 10/03 11:00 Manaus
});
afterAll(async () => amb.app.close());

describe('adesão e compras', () => {
  it('adere com OTP e consentimentos separados', async () => {
    maria = await aderir(CPF_MARIA, 'Maria da Silva', '(92) 99111-0000');
    const perfil = await amb
      .http()
      .get('/app/perfil')
      .set('Authorization', `Bearer ${maria.token}`);
    expect(perfil.body.consentimentos).toEqual({ ADESAO_PROGRAMA: true, MARKETING_WHATSAPP: true });
    const repetida = await amb
      .http()
      .post('/participantes/adesao/otp')
      .send({ cpf: CPF_MARIA, telefone: '(92) 98888-7777' });
    expect(repetida.body.enviadoPara).toBe('(92) *****-0000'); // vai para o telefone já cadastrado
  });

  it('cenários 1, 2 e 5: 1ª compra com boas-vindas (6%), frete/serviço fora; 2ª compra 3%', async () => {
    const r = await importar('vendas-1.csv', [
      ...venda('1001', CPF_MARIA, [
        { item: '1', sku: 'FUR-01', valor: '200,00' },
        { item: '2', sku: 'FRETE', valor: '30,00', tipo: 'FRETE' },
        { item: '3', sku: 'MONT', valor: '50,00', tipo: 'SERVICO' },
      ]),
      ...venda(
        '1002',
        CPF_MARIA,
        [{ item: '1', sku: 'SER-01', valor: '220,00', desconto: '20,00' }],
        { data: '10/03/2026 15:00' },
      ),
      ...venda('1003', CPF_MARIA, [{ item: '1', sku: 'PAR-01', valor: '49,99' }], {
        data: '10/03/2026 16:00',
      }),
    ]);
    expect(r.status).toBe('CONCLUIDA');
    expect(r.resumo).toMatchObject({ vendasNovas: 3, cashbackCentavos: 1_200 + 600 });
    const lotes = await amb.prisma.lancamento.findMany({
      where: { tipo: 'CREDITO' },
      orderBy: { seq: 'asc' },
    });
    expect(lotes.map((l) => [l.valorCentavos, l.origem, l.estado])).toEqual([
      [1_200, 'BOAS_VINDAS', 'PENDENTE'],
      [600, 'COMPRA', 'PENDENTE'],
    ]);
    expect(lotes[0].liberaEm?.toISOString()).toBe('2026-03-17T04:00:00.000Z');
    expect(lotes[0].regraVersaoId).toBeTruthy();
  });

  it('cenário 8: o mesmo arquivo importado de novo não gera crédito duplicado', async () => {
    const r = await importar(
      'vendas-1-de-novo.csv',
      venda('1001', CPF_MARIA, [{ item: '1', sku: 'FUR-01', valor: '200,00' }]),
    );
    expect(r.resumo).toMatchObject({ vendasNovas: 0, vendasRepetidas: 1 });
    expect(await amb.prisma.lancamento.count({ where: { tipo: 'CREDITO' } })).toBe(2);
  });

  it('libera após a carência e o caixa respeita 20% da compra (cenários 1 e 6)', async () => {
    amb.relogio.definir(new Date('2026-03-17T13:00:00Z'));
    const job = await amb.http().post('/jobs/liberar-creditos').set(admin());
    expect(job.body).toMatchObject({ liberados: 2, valorCentavos: 1_800 });
    const consulta = await amb
      .http()
      .get(`/caixa/consulta?busca=${CPF_MARIA}&valorCompraCentavos=5000`)
      .set(admin());
    const c = consulta.body.titulares[0].carteiras[0];
    expect(c).toMatchObject({
      elegivel: true,
      limitePorCompraCentavos: 1_000,
      maximoResgatavelCentavos: 1_000,
    });
    const acima = await amb.http().post('/reservas').set(admin()).send({
      carteiraId: c.id,
      valorCompraCentavos: 5_000,
      valorCentavos: 1_001,
      lojaId: 'LOJA-01',
    });
    expect(acima.status).toBe(422);
    expect(acima.body.erro).toBe('VALOR_ACIMA_DO_LIMITE');
  });

  it('cenário 4: compra paga com cashback → reserva, código no ERP, conciliação e base sem a parcela de cashback', async () => {
    const c = (await carteiraCliente(maria.token)).id;
    const reserva = await amb
      .http()
      .post('/reservas')
      .set(admin())
      .set('Idempotency-Key', 'caixa-1')
      .send({
        carteiraId: c,
        valorCompraCentavos: 20_000,
        valorCentavos: 1_500,
        lojaId: 'LOJA-01',
      });
    expect(reserva.status).toBe(201);
    const codigo = reserva.body.codigo;
    const conf = await amb
      .http()
      .post(`/reservas/${reserva.body.id}/confirmar`)
      .set(admin())
      .send({ vendaErpRef: '2001' });
    expect(conf.body.status).toBe('CONFIRMADA');
    const r = await importar(
      'vendas-2.csv',
      venda('2001', CPF_MARIA, [{ item: '1', sku: 'FUR-02', valor: '200,00' }], {
        data: '17/03/2026 10:00',
        pago_cashback: '15,00',
        codigo_resgate: codigo,
      }),
    );
    expect(r.resumo.cashbackCentavos).toBe(555); // 3% de (200,00 − 15,00)
    const v = await amb.prisma.venda.findFirstOrThrow({ where: { documentoErp: '2001' } });
    expect(v.baseCalculoCentavos).toBe(18_500);
    const reservaDb = await amb.prisma.reserva.findUniqueOrThrow({ where: { codigo } });
    expect(reservaDb.vendaId).toBe(v.id);
    expect(await amb.prisma.divergencia.count()).toBe(0);
  });

  it('cenários 9 e 10: devolução parcial estorna; devolução de crédito já usado gera saldo devedor', async () => {
    // devolução de metade do valor da venda 1002 (crédito 600 ainda disponível no lote? foi usado no resgate FIFO)
    const antes = await amb.http().get('/app/inicio').set('Authorization', `Bearer ${maria.token}`);
    expect(antes.body.carteiras[0].saldos.disponivelCentavos).toBe(300);
    const r = await importar('devolucoes.csv', [
      {
        tipo_movimento: 'DEVOLUCAO',
        loja: '01',
        documento: 'D-1',
        documento_origem: '1001',
        data: '18/03/2026 10:00',
        item: '1',
        sku: 'FUR-01',
        valor_bruto: '200,00',
        quantidade: '1',
      },
    ]);
    expect(r.resumo.devolucoes).toBe(1);
    const resumo = (await carteiraCliente(maria.token)).saldos;
    // lote de boas-vindas (1.200) foi todo usado no resgate de 15,00 → 1.200 viram saldo devedor,
    // abatido na hora com os 3,00 livres → devedor 9,00 e resgates bloqueados
    expect(resumo).toMatchObject({ disponivelCentavos: 0, devedorCentavos: 900 });
    const extrato = await amb
      .http()
      .get(`/carteiras/${(await carteiraCliente(maria.token)).id}/lancamentos`)
      .set(admin());
    const origens = extrato.body.itens.map((i: { origem: string }) => i.origem);
    expect(origens).toContain('ESTORNO');
    expect(origens).toContain('QUITACAO_SALDO_DEVEDOR');
    const venda1001 = await amb.prisma.venda.findFirstOrThrow({ where: { documentoErp: '1001' } });
    expect(venda1001.status).toBe('CONFIRMADA'); // frete e serviço não foram devolvidos
    expect(venda1001.cashbackCentavos).toBe(0);
  });
});

describe('prestadores e indicação', () => {
  it('candidatura, aprovação com código único e QR', async () => {
    joao = await aderir(CPF_JOAO, 'João Prestador', '(92) 99222-0000');
    const cand = await amb
      .http()
      .post('/app/prestador/candidatura')
      .set('Authorization', `Bearer ${joao.token}`)
      .send({
        especialidades: ['eletricista'],
        bairros: ['Cidade Nova'],
        whatsapp: '(92) 99222-0000',
        aceiteTermos: true,
        aceiteCodigoConduta: true,
      });
    expect(cand.status).toBe(201);
    prestadorId = cand.body.id;
    const ap = await amb.http().post(`/prestadores/${prestadorId}/aprovar`).set(admin());
    expect(ap.body.status).toBe('APROVADO');
    codigoPrestador = ap.body.codigo;
    expect(codigoPrestador).toMatch(/^CDC-JOAO[2-9]{2}$/);
    const area = await amb
      .http()
      .get('/app/prestador')
      .set('Authorization', `Bearer ${joao.token}`);
    expect(area.body.qr).toMatch(/^data:image\/png;base64,/);
    expect(area.body.link).toContain(`/i/${codigoPrestador}`);
  });

  it('cenário 11: venda indicada (Bronze) → comprador 3% e prestador 3% em carteiras distintas', async () => {
    const ana = await aderir(CPF_ANA, 'Ana Souza', '(92) 99333-0000');
    await importar(
      'indicada.csv',
      venda('3001', CPF_ANA, [{ item: '1', sku: 'CAB-01', valor: '200,00', familia: 'ELETRICA' }], {
        data: '17/03/2026 11:00',
        codigo_indicacao: codigoPrestador.toLowerCase(),
      }),
    );
    const v = await amb.prisma.venda.findFirstOrThrow({
      where: { documentoErp: '3001' },
      include: { lancamentos: { include: { carteira: true } } },
    });
    expect(v.cashbackCentavos).toBe(1_200); // 1ª compra da Ana: boas-vindas 6%
    expect(v.recompensaCentavos).toBe(600);
    const tipos = v.lancamentos.map((l) => [l.carteira.tipo, l.origem, l.valorCentavos]).sort();
    expect(tipos).toEqual(
      [
        ['CLIENTE', 'BOAS_VINDAS', 1_200],
        ['PRESTADOR', 'INDICACAO', 600],
      ].sort(),
    );
    // vínculo de 90 dias: próxima compra sem código também é atribuída
    await importar(
      'indicada-2.csv',
      venda('3002', CPF_ANA, [{ item: '1', sku: 'CAB-02', valor: '100,00', familia: 'ELETRICA' }], {
        data: '18/03/2026 11:00',
      }),
    );
    const v2 = await amb.prisma.venda.findFirstOrThrow({ where: { documentoErp: '3002' } });
    expect([v2.prestadorIndicadorId, v2.origemIndicacao, v2.recompensaCentavos]).toEqual([
      prestadorId,
      'VINCULO',
      300,
    ]);
    const area = await amb
      .http()
      .get('/app/prestador')
      .set('Authorization', `Bearer ${joao.token}`);
    expect(area.body.vendasIndicadas[0].comprador).toBe('Ana'); // só o primeiro nome
    expect(JSON.stringify(area.body)).not.toContain(CPF_ANA);
    expect(ana.pessoa.id).toBeTruthy();
  });

  it('cenário 12: autoindicação → recompensa bloqueada e alerta', async () => {
    await importar(
      'auto.csv',
      venda(
        '3003',
        CPF_JOAO,
        [{ item: '1', sku: 'CAB-03', valor: '300,00', familia: 'ELETRICA' }],
        { data: '18/03/2026 12:00', codigo_indicacao: codigoPrestador },
      ),
    );
    const v = await amb.prisma.venda.findFirstOrThrow({ where: { documentoErp: '3003' } });
    expect(v.recompensaCentavos).toBe(0);
    expect(v.cashbackCentavos).toBeGreaterThan(0);
    const alertas = await amb.http().get('/alertas?tipo=AUTOINDICACAO').set(admin());
    expect(alertas.body).toHaveLength(1);
  });

  it('cenário 13: teto mensal de R$ 1.000 → excedente não gerado e registrado', async () => {
    // já concedidos 9,00 no mês; venda de R$ 40.000 geraria 1.200,00
    await importar(
      'grande.csv',
      venda(
        '3004',
        CPF_ANA,
        [{ item: '1', sku: 'GER-01', valor: '40000,00', familia: 'ELETRICA' }],
        { data: '19/03/2026 10:00', codigo_indicacao: codigoPrestador },
      ),
    );
    const v = await amb.prisma.venda.findFirstOrThrow({ where: { documentoErp: '3004' } });
    expect(v.recompensaCalculadaCentavos).toBe(120_000);
    expect(v.recompensaCentavos).toBe(100_000 - 900);
    expect(v.recompensaExcedenteCentavos).toBe(120_000 - (100_000 - 900));
    expect(await amb.prisma.alerta.count({ where: { tipo: 'TETO_MENSAL' } })).toBe(1);
  });

  it('cenário 14: prestador comprando para si (tabela meio de campo) → sem cashback', async () => {
    await importar(
      'propria.csv',
      venda(
        '3005',
        CPF_JOAO,
        [{ item: '1', sku: 'DIS-01', valor: '500,00', familia: 'ELETRICA' }],
        { data: '19/03/2026 11:00', tabela_preco: 'MEIO_DE_CAMPO' },
      ),
    );
    const v = await amb.prisma.venda.findFirstOrThrow({ where: { documentoErp: '3005' } });
    expect([v.perfilAplicado, v.cashbackCentavos]).toEqual(['PRESTADOR', 0]);
  });

  it('troca de indicador após o fechamento exige permissão e justificativa', async () => {
    const v = await amb.prisma.venda.findFirstOrThrow({ where: { documentoErp: '3002' } });
    const sem = await amb
      .http()
      .post(`/vendas/${v.id}/indicador`)
      .set(admin())
      .send({ codigo: null, justificativa: 'curta' });
    expect(sem.status).toBe(400);
    const ok = await amb
      .http()
      .post(`/vendas/${v.id}/indicador`)
      .set(admin())
      .send({ codigo: null, justificativa: 'cliente informou que não houve indicação' });
    expect(ok.status).toBe(201);
    expect(await amb.prisma.auditoria.count({ where: { acao: 'INDICADOR_ALTERADO' } })).toBe(1);
  });
});

describe('regras versionadas pela API', () => {
  it('cenários 15, 16 e 17: família não elegível, SKU sobre família e nova versão preserva cálculo antigo', async () => {
    const operador = await amb
      .http()
      .post('/usuarios')
      .set(admin())
      .send({
        nome: 'Operador Caixa',
        email: 'caixa@cdc.local',
        senha: 'senha-operador-123',
        permissoes: ['operacao_caixa'],
      });
    expect(operador.status).toBe(201);
    const login = await amb
      .http()
      .post('/auth/equipe/login')
      .send({ email: 'caixa@cdc.local', senha: 'senha-operador-123' });
    const negado = await amb
      .http()
      .post('/regras/versoes')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({
        escopo: 'FAMILIA',
        filtros: { familia: 'CIMENTO' },
        parametros: { elegivel: false },
        motivo: 'margem baixa',
      });
    expect(negado.status).toBe(403);

    const fam = await amb
      .http()
      .post('/regras/versoes')
      .set(admin())
      .send({
        escopo: 'FAMILIA',
        filtros: { familia: 'CIMENTO' },
        parametros: { elegivel: false },
        motivo: 'margem baixa no cimento',
      });
    expect(fam.status).toBe(201);
    await amb
      .http()
      .post('/regras/versoes')
      .set(admin())
      .send({
        escopo: 'FAMILIA',
        filtros: { familia: 'ELETRICA' },
        parametros: { cashbackBps: 200 },
        motivo: 'elétrica com 2%',
      });
    await amb
      .http()
      .post('/regras/versoes')
      .set(admin())
      .send({
        escopo: 'PRODUTO',
        filtros: { sku: 'CABO-10' },
        parametros: { cashbackBps: 500 },
        motivo: 'cabo 10mm com 5%',
      });
    const sim = await amb
      .http()
      .post('/regras/simular')
      .set(admin())
      .send({
        itens: [
          { id: '1', sku: 'CIM-50', familia: 'CIMENTO', valorBrutoCentavos: 10_000 },
          { id: '2', sku: 'CABO-10', familia: 'ELETRICA', valorBrutoCentavos: 10_000 },
          { id: '3', sku: 'DISJ', familia: 'ELETRICA', valorBrutoCentavos: 10_000 },
          { id: '4', sku: 'MART', familia: 'FERRAMENTAS', valorBrutoCentavos: 10_000 },
        ],
      });
    expect(sim.body.resultado.itens.map((i: { cashbackBps: number }) => i.cashbackBps)).toEqual([
      0, 500, 200, 300,
    ]);
    expect(sim.body.resultado.cashback.valorCentavos).toBe(1_000);

    // nova versão da regra geral (4%) — lançamentos antigos continuam apontando para a v1
    const v1 = await amb.prisma.regraVersao.findFirstOrThrow({
      where: { regra: { chave: 'PERFIL:CLIENTE_CPF' }, versao: 1 },
    });
    const nova = await amb
      .http()
      .post('/regras/versoes')
      .set(admin())
      .send({
        escopo: 'PERFIL',
        filtros: { perfil: 'CLIENTE_CPF' },
        parametros: {
          cashbackBps: 400,
          compraMinimaCentavos: 5_000,
          boasVindas: { multiplicadorPct: 200, tetoBps: 600 },
          aceitaSobrescritas: true,
        },
        motivo: 'campanha de aniversário',
      });
    expect(nova.body.versao.versao).toBe(2);
    const retro = await amb
      .http()
      .post('/regras/versoes')
      .set(admin())
      .send({
        escopo: 'PERFIL',
        filtros: { perfil: 'CLIENTE_CPF' },
        parametros: {
          cashbackBps: 100,
          compraMinimaCentavos: 0,
          boasVindas: null,
          aceitaSobrescritas: true,
        },
        vigenciaInicio: '2026-01-01T00:00:00Z',
        motivo: 'tentativa retroativa',
      });
    expect(retro.body.erro).toBe('VIGENCIA_RETROATIVA');
    const antigos = await amb.prisma.lancamento.findMany({
      where: { origem: 'COMPRA', tipo: 'CREDITO', venda: { documentoErp: '1002' } },
    });
    expect(antigos[0].regraVersaoId).toBe(v1.id);
    await importar(
      'apos-v2.csv',
      venda('4001', CPF_MARIA, [{ item: '1', sku: 'MART-2', valor: '100,00' }], {
        data: '19/03/2026 12:00',
      }),
    );
    const v = await amb.prisma.venda.findFirstOrThrow({ where: { documentoErp: '4001' } });
    expect([v.cashbackCentavos, v.regraVersaoId]).toEqual([400, nova.body.versao.id]);
    expect(await amb.prisma.auditoria.count({ where: { acao: 'REGRA_NOVA_VERSAO' } })).toBe(4);
  });
});

describe('conciliação, relatórios e LGPD', () => {
  it('reserva confirmada sem venda vira divergência; visão geral consolida', async () => {
    const c = (await carteiraCliente(maria.token)).id;
    await amb.prisma.lancamento.count();
    await amb
      .http()
      .post(`/carteiras/${c}/ajustes`)
      .set(admin())
      .send({ valorCentavos: 2_000, motivo: 'crédito de cortesia para teste' });
    const r = await amb.http().post('/reservas').set(admin()).send({
      carteiraId: c,
      valorCompraCentavos: 10_000,
      valorCentavos: 1_000,
      lojaId: 'LOJA-02',
    });
    await amb.http().post(`/reservas/${r.body.id}/confirmar`).set(admin()).send({});
    amb.relogio.definir(new Date('2026-03-25T13:00:00Z'));
    const conc = await amb.http().post('/conciliacao/executar').set(admin());
    expect(conc.body.reservasSemVenda).toBe(1);
    const div = await amb.http().get('/conciliacao/divergencias?status=ABERTA').set(admin());
    expect(div.body.map((d: { tipo: string }) => d.tipo)).toContain('RESERVA_SEM_VENDA');
    const tratada = await amb
      .http()
      .patch(`/conciliacao/divergencias/${div.body[0].id}`)
      .set(admin())
      .send({ status: 'RESOLVIDA', resolucao: 'venda lançada em outra loja; ajustado' });
    expect(tratada.body.status).toBe('RESOLVIDA');
    const vg = await amb.http().get('/relatorios/visao-geral?dias=60').set(admin());
    expect(vg.body.adesoesPeriodo).toBe(3);
    expect(vg.body.cashback.emitidoCentavos).toBeGreaterThan(0);
    expect(vg.body.vendasIndicadas.quantidade).toBeGreaterThan(0);
  });

  it('notificações respeitam consentimento e horário comercial', async () => {
    amb.relogio.definir(new Date('2026-03-26T02:00:00Z')); // 25/03 22:00 Manaus — fora do horário
    expect((await amb.http().post('/jobs/enviar-notificacoes').set(admin())).body.adiadas).toBe(
      true,
    );
    amb.relogio.definir(new Date('2026-03-26T14:00:00Z')); // 26/03 10:00 Manaus
    const r = await amb.http().post('/jobs/enviar-notificacoes').set(admin());
    expect(r.body.enviadas).toBeGreaterThan(0);
  });

  it('exclusão de conta (LGPD) anonimiza e mantém o livro-razão', async () => {
    const r = await amb
      .http()
      .delete('/app/conta')
      .set('Authorization', `Bearer ${maria.token}`)
      .send({ confirmo: true });
    expect(r.status).toBe(200);
    const p = await amb.prisma.pessoa.findUniqueOrThrow({ where: { id: maria.pessoa.id } });
    expect(p.cpf).toMatch(/^ANON-/);
    expect(p.telefone).toBeNull();
    expect(
      await amb.prisma.lancamento.count({ where: { carteira: { pessoaId: maria.pessoa.id } } }),
    ).toBeGreaterThan(0);
  });

  it('OpenAPI e rotas protegidas', async () => {
    expect((await amb.http().get('/relatorios/visao-geral')).status).toBe(401);
    expect((await amb.http().get('/regras/texto')).status).toBe(200);
  });
});
