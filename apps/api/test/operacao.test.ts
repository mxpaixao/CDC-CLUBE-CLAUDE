/**
 * Operação: XLSX, devolução por quantidade, cancelamento, contingência, OTP do prestador no caixa,
 * pré-registro de indicação, login do participante e idempotência de devoluções.
 */
import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gerarCpfValido } from '@cdc/shared';
import { ProvedorConsole } from '../src/notificacoes/provedores';
import { type Ambiente, criarAmbiente } from './ambiente';

let amb: Ambiente;
const admin = () => ({ Authorization: `Bearer ${amb.tokenAdmin}` });
const CPF_CLIENTE = gerarCpfValido('123456789');
const CPF_PRESTADOR = gerarCpfValido('987654321');
const ultimoCodigo = (tel: string) =>
  /(\d{6})/.exec(ProvedorConsole.ultimaPara(tel)?.texto ?? '')?.[1];

async function aderir(cpf: string, nome: string, tel: string) {
  await amb.http().post('/participantes/adesao/otp').send({ cpf, telefone: tel });
  const r = await amb
    .http()
    .post('/participantes/adesao')
    .send({
      tipo: 'CPF',
      cpf,
      nome,
      codigo: ultimoCodigo(`+55${tel}`),
      consentimentos: { ADESAO_PROGRAMA: true },
    });
  expect(r.status).toBe(201);
  return r.body;
}

async function xlsx(linhas: Record<string, string | number>[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('vendas');
  const colunas = Object.keys(linhas[0]);
  ws.addRow(colunas);
  for (const l of linhas) ws.addRow(colunas.map((c) => l[c]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

beforeAll(async () => {
  amb = await criarAmbiente(new Date('2026-05-04T14:00:00Z')); // segunda 10:00 Manaus
});
afterAll(async () => amb.app.close());

describe('importação e devoluções', () => {
  it('importa XLSX, devolve por quantidade e cancela; reimportar devolução não duplica', async () => {
    await aderir(CPF_CLIENTE, 'Carlos Lima', '92991234567');
    const base = {
      tipo_movimento: 'VENDA',
      loja: '02',
      data: '04/05/2026 11:00',
      comprador_documento: CPF_CLIENTE,
      familia: 'HIDRAULICA',
      subfamilia: 'HID-01',
    };
    const arquivo = await xlsx([
      {
        ...base,
        documento: '9001',
        item: '1',
        sku: 'TUBO',
        quantidade: '10',
        valor_bruto: '100,00',
        desconto: '0',
      },
      {
        ...base,
        documento: '9001',
        item: '2',
        sku: 'JOELHO',
        quantidade: '4',
        valor_bruto: '100,00',
        desconto: '0',
      },
      {
        ...base,
        documento: '9002',
        item: '1',
        sku: 'TUBO',
        quantidade: '1',
        valor_bruto: '80,00',
        desconto: '0',
      },
    ]);
    const imp = await amb
      .http()
      .post('/importacoes')
      .set(admin())
      .attach('arquivo', arquivo, 'vendas.xlsx');
    expect(imp.body).toMatchObject({ status: 'CONCLUIDA', linhasOk: 3 });
    // 9001: 1ª compra → 6% de 200,00 = 12,00
    const v = await amb.prisma.venda.findFirstOrThrow({ where: { documentoErp: '9001' } });
    expect(v.cashbackCentavos).toBe(1_200);

    const dev =
      'tipo_movimento;loja;documento;documento_origem;data;item;quantidade\nDEVOLUCAO;02;DV-1;9001;05/05/2026 09:00;1;5\n';
    const r1 = await amb
      .http()
      .post('/importacoes')
      .set(admin())
      .attach('arquivo', Buffer.from(dev), 'dev.csv');
    expect(r1.body.erros).toEqual([]);
    expect(r1.body.status).toBe('CONCLUIDA');
    const depois = await amb.prisma.venda.findFirstOrThrow({ where: { documentoErp: '9001' } });
    expect(depois.cashbackCentavos).toBe(900); // 6% de 150,00 (devolveu 5 de 10 tubos = 50,00)
    const r2 = await amb
      .http()
      .post('/importacoes')
      .set(admin())
      .attach('arquivo', Buffer.from(dev), 'dev-de-novo.csv');
    expect(r2.body.linhasIgnoradas).toBe(1);
    expect(r2.body.resumo.arquivoJaImportadoEm).toBeTruthy();
    expect(await amb.prisma.devolucao.count()).toBe(1);

    const canc =
      'tipo_movimento;loja;documento;data;item\nCANCELAMENTO;02;9002;05/05/2026 10:00;1\n';
    await amb
      .http()
      .post('/importacoes')
      .set(admin())
      .attach('arquivo', Buffer.from(canc), 'canc.csv');
    const v2 = await amb.prisma.venda.findFirstOrThrow({ where: { documentoErp: '9002' } });
    expect([v2.status, v2.cashbackCentavos]).toEqual(['CANCELADA', 0]);
    const lote = await amb.prisma.lancamento.findFirstOrThrow({
      where: { vendaId: v2.id, tipo: 'CREDITO' },
    });
    expect(lote.estado).toBe('ESTORNADO');
  });

  it('o arquivo de exemplo da documentação importa sem erros', async () => {
    const exemplo = readFileSync(join(__dirname, '../../../docs/exemplos/vendas-exemplo.csv'));
    const r = await amb
      .http()
      .post('/importacoes')
      .set(admin())
      .attach('arquivo', exemplo, 'vendas-exemplo.csv');
    expect(r.body).toMatchObject({ status: 'CONCLUIDA', linhasErro: 0, linhasOk: 4 });
    expect(r.body.resumo).toMatchObject({ vendasNovas: 2, devolucoes: 1 });
  });

  it('linhas inválidas são reportadas sem bloquear o restante do arquivo', async () => {
    const csv = [
      'tipo_movimento;loja;documento;data;comprador_documento;item;sku;valor_bruto;desconto',
      `VENDA;02;9101;06/05/2026 10:00;${CPF_CLIENTE};1;A;100,00;0`,
      `VENDA;99;9102;06/05/2026 10:00;${CPF_CLIENTE};1;B;100,00;0`,
      `VENDA;02;9103;data-ruim;${CPF_CLIENTE};1;C;100,00;0`,
      `VENDA;02;9104;06/05/2026 10:00;${CPF_CLIENTE};1;D;10,555;0`,
    ].join('\n');
    const r = await amb
      .http()
      .post('/importacoes')
      .set(admin())
      .attach('arquivo', Buffer.from(csv), 'misto.csv');
    expect(r.body).toMatchObject({ status: 'CONCLUIDA_COM_ERROS', linhasOk: 1, linhasErro: 3 });
    expect(r.body.erros.map((e: { erro: string }) => e.erro).join(' | ')).toMatch(
      /data inválida.*|loja 99/,
    );
    const semColunas = await amb
      .http()
      .post('/importacoes')
      .set(admin())
      .attach('arquivo', Buffer.from('a;b\n1;2'), 'errado.csv');
    expect(semColunas.body.status).toBe('CONCLUIDA_COM_ERROS');
    expect(semColunas.body.erros[0].erro).toMatch(/colunas obrigatórias/);
  });
});

describe('caixa', () => {
  it('participante entra com OTP e gera código para o caixa', async () => {
    const otp = await amb.http().post('/auth/participante/otp').send({ cpf: CPF_CLIENTE });
    expect(otp.body.cadastrado).toBe(true);
    const neutro = await amb
      .http()
      .post('/auth/participante/otp')
      .send({ cpf: gerarCpfValido('555444333') });
    expect(neutro.body).toMatchObject({ cadastrado: false, enviadoPara: null });
    const errado = await amb
      .http()
      .post('/auth/participante/entrar')
      .send({ cpf: CPF_CLIENTE, codigo: '000000' });
    expect(errado.status).toBe(401);
    const ok = await amb
      .http()
      .post('/auth/participante/entrar')
      .send({ cpf: CPF_CLIENTE, codigo: ultimoCodigo('+5592991234567') });
    expect(ok.status).toBe(200);
    expect(ok.headers['set-cookie'][0]).toMatch(/cdc_app=.*HttpOnly/);
    const cod = await amb
      .http()
      .post('/app/codigo-caixa')
      .set('Authorization', `Bearer ${ok.body.token}`);
    expect(cod.body.codigo).toMatch(/^\d{6}$/);
    // cookie sem header anti-CSRF é recusado em escrita
    const csrf = await amb
      .http()
      .post('/app/codigo-caixa')
      .set('Cookie', `cdc_app=${ok.body.token}`);
    expect(csrf.status).toBe(403);
  });

  it('resgate de carteira de prestador exige OTP do titular; pré-registro de indicação', async () => {
    const p = await aderir(CPF_PRESTADOR, 'Pedro Pintor', '92992223333');
    const cand = await amb
      .http()
      .post('/app/prestador/candidatura')
      .set('Authorization', `Bearer ${p.token}`)
      .send({
        especialidades: ['pintor'],
        bairros: ['Centro'],
        whatsapp: '92992223333',
        aceiteTermos: true,
        aceiteCodigoConduta: true,
      });
    const ap = await amb.http().post(`/prestadores/${cand.body.id}/aprovar`).set(admin());
    const carteira = await amb.prisma.carteira.findFirstOrThrow({
      where: { pessoaId: p.pessoa.id, tipo: 'PRESTADOR' },
    });
    await amb
      .http()
      .post(`/carteiras/${carteira.id}/ajustes`)
      .set(admin())
      .send({ valorCentavos: 5_000, motivo: 'bônus de boas-vindas ao prestador' });

    const pre = await amb
      .http()
      .post('/indicacoes/pre-registro')
      .set(admin())
      .send({ lojaId: 'LOJA-02', documentoErp: '9200', codigo: ap.body.codigo });
    expect(pre.status).toBe(201);
    const outro = await amb
      .http()
      .post('/indicacoes/pre-registro')
      .set(admin())
      .send({ lojaId: 'LOJA-02', documentoErp: '9200', codigo: 'CDC-XYZ22' });
    expect(outro.status).toBe(422);
    await amb
      .http()
      .post('/importacoes')
      .set(admin())
      .attach(
        'arquivo',
        Buffer.from(
          `tipo_movimento;loja;documento;data;comprador_documento;item;sku;valor_bruto;desconto\nVENDA;02;9200;06/05/2026 11:00;${CPF_CLIENTE};1;TINTA;300,00;0\n`,
        ),
        'pre.csv',
      );
    const v = await amb.prisma.venda.findFirstOrThrow({ where: { documentoErp: '9200' } });
    expect([v.origemIndicacao, v.recompensaCentavos]).toEqual(['PRE_REGISTRO', 900]);

    const sem = await amb.http().post('/reservas').set(admin()).send({
      carteiraId: carteira.id,
      valorCompraCentavos: 10_000,
      valorCentavos: 1_000,
      lojaId: 'LOJA-02',
    });
    expect(sem.body.erro).toBe('AUTENTICACAO_TITULAR');
    await amb.http().post('/caixa/otp').set(admin()).send({ carteiraId: carteira.id });
    const com = await amb
      .http()
      .post('/reservas')
      .set(admin())
      .send({
        carteiraId: carteira.id,
        valorCompraCentavos: 10_000,
        valorCentavos: 1_000,
        lojaId: 'LOJA-02',
        codigoTitular: ultimoCodigo('+5592992223333'),
      });
    expect(com.status).toBe(201);
    expect(com.body.autenticacaoTitular).toBe('OTP');
  });

  it('contingência pausa liberações e exige supervisor para resgatar', async () => {
    await amb
      .http()
      .put('/sistema/contingencia')
      .set(admin())
      .send({ ativa: true, motivo: 'ERP fora do ar' });
    amb.relogio.definir(new Date('2026-05-20T14:00:00Z'));
    expect((await amb.http().post('/jobs/liberar-creditos').set(admin())).body.pausado).toBe(true);
    const cliente = await amb.prisma.carteira.findFirstOrThrow({
      where: { pessoa: { cpf: CPF_CLIENTE }, tipo: 'CLIENTE' },
    });
    await amb
      .http()
      .post(`/carteiras/${cliente.id}/ajustes`)
      .set(admin())
      .send({ valorCentavos: 3_000, motivo: 'crédito para teste de contingência' });
    const bloqueada = await amb.http().post('/reservas').set(admin()).send({
      carteiraId: cliente.id,
      valorCompraCentavos: 10_000,
      valorCentavos: 1_000,
      lojaId: 'LOJA-02',
    });
    expect(bloqueada.status).toBe(423);
    const liberada = await amb.http().post('/reservas').set(admin()).send({
      carteiraId: cliente.id,
      valorCompraCentavos: 10_000,
      valorCentavos: 1_000,
      lojaId: 'LOJA-02',
      liberacaoSupervisor: 'conferido no ERP manualmente pelo gerente',
    });
    expect(liberada.status).toBe(201);
    await amb
      .http()
      .put('/sistema/contingencia')
      .set(admin())
      .send({ ativa: false, motivo: 'ERP normalizado' });
    expect(
      (await amb.http().post('/jobs/liberar-creditos').set(admin())).body.liberados,
    ).toBeGreaterThan(0);
    expect(
      await amb.prisma.auditoria.count({ where: { acao: { startsWith: 'CONTINGENCIA' } } }),
    ).toBe(2);
  });
});
