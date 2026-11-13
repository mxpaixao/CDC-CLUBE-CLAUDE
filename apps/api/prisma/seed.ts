/**
 * Seed de implantação: regra v1 aprovada, 4 lojas, permissões, templates, mapeamento padrão,
 * usuários de exemplo e (opcional, SEED_EXEMPLOS=true) dados fictícios para demonstração.
 *
 *   SEED_SENHA_ADMIN=... SEED_EXEMPLOS=true pnpm --filter @cdc/api seed
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { gerarCnpjValido } from '@cdc/shared';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { SISTEMA } from '../src/comum/auditoria.service';
import { LivroRazaoService } from '../src/carteiras/livro-razao.service';
import { PrestadoresService } from '../src/prestadores/prestadores.service';
import { ProcessamentoVendasService } from '../src/vendas/processamento.service';
import { semearBase } from './seed-dados';

const SENHA_ADMIN = process.env.SEED_SENHA_ADMIN ?? 'Trocar@Agora123';
const SENHA_EXEMPLO = process.env.SEED_SENHA_EXEMPLO ?? 'Exemplo@CDC2026';

async function main() {
  const prisma = new PrismaClient();
  const implantacao = process.env.SEED_IMPLANTACAO
    ? new Date(process.env.SEED_IMPLANTACAO)
    : new Date(Date.now() - 60 * 86_400_000);
  await semearBase(prisma, implantacao, SENHA_ADMIN);
  console.log(
    `✔ base: regra v1 (vigente desde ${implantacao.toISOString()}), 4 lojas, permissões, templates`,
  );

  const usuarios = [
    {
      nome: 'Operador Caixa Matriz',
      email: 'caixa@cdc.local',
      permissoes: ['operacao_caixa', 'cadastro'],
      lojaId: 'LOJA-01',
    },
    {
      nome: 'Gerente Comercial',
      email: 'gerente@cdc.local',
      permissoes: ['visualizacao_relatorios', 'aprovacao_prestador', 'ajuste_saldo', 'cadastro'],
      lojaId: null,
    },
    {
      nome: 'Marketing',
      email: 'marketing@cdc.local',
      permissoes: ['alteracao_regras', 'visualizacao_relatorios'],
      lojaId: null,
    },
  ];
  for (const u of usuarios) {
    await prisma.usuarioCdc.upsert({
      where: { email: u.email },
      create: { ...u, senhaHash: await argon2.hash(SENHA_EXEMPLO, { type: argon2.argon2id }) },
      update: {},
    });
  }
  console.log(`✔ usuários de exemplo (senha: ${SENHA_EXEMPLO}) — troque antes de produção`);

  if (process.env.SEED_EXEMPLOS === 'true' && (await prisma.pessoa.count()) === 0) {
    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: ['error', 'warn'],
      abortOnError: false,
    });
    const livro = app.get(LivroRazaoService);
    const processamento = app.get(ProcessamentoVendasService);
    const prestadores = app.get(PrestadoresService);
    const adesao = new Date(implantacao.getTime() + 86_400_000);
    const pessoas = [
      { cpf: '52998224725', nome: 'Maria Fictícia da Silva', telefone: '+5592991110000' },
      { cpf: '11144477735', nome: 'João Fictício Eletricista', telefone: '+5592992220000' },
      { cpf: '39053344705', nome: 'Ana Fictícia Souza', telefone: '+5592993330000' },
    ];
    const ids: Record<string, string> = {};
    for (const p of pessoas) {
      const pessoa = await prisma.pessoa.create({ data: p });
      ids[p.cpf] = pessoa.id;
      await prisma.participante.create({
        data: { tipo: 'CPF', pessoaId: pessoa.id, dataAdesao: adesao, canalAdesao: 'SEED' },
      });
      for (const tipo of ['ADESAO_PROGRAMA', 'MARKETING_WHATSAPP']) {
        await prisma.consentimento.create({
          data: {
            pessoaId: pessoa.id,
            tipo,
            concedido: true,
            versaoTermo: 'v1-2026',
            origem: 'SEED',
          },
        });
      }
      await prisma.$transaction((tx) =>
        livro.obterOuCriarCarteira(tx, 'CLIENTE', { pessoaId: pessoa.id }),
      );
    }
    const cnpj = gerarCnpjValido('123456780001');
    const empresa = await prisma.empresa.create({
      data: { cnpj, razaoSocial: 'Construtora Fictícia Rio Negro Ltda' },
    });
    await prisma.empresaComprador.create({
      data: { empresaId: empresa.id, pessoaId: ids['39053344705'], papel: 'RESPONSAVEL' },
    });
    await prisma.participante.create({
      data: { tipo: 'EMPRESA', empresaId: empresa.id, dataAdesao: adesao, canalAdesao: 'SEED' },
    });

    const prestador = await prestadores.candidatar(
      ids['11144477735'],
      {
        especialidades: ['eletricista'],
        bairros: ['Cidade Nova', 'Centro'],
        whatsapp: '92992220000',
        aceiteTermos: true,
        aceiteCodigoConduta: true,
      },
      SISTEMA,
    );
    const aprovado = await prestadores.aprovar(prestador.id, SISTEMA);

    const dia = (n: number) => new Date(adesao.getTime() + n * 86_400_000 + 15 * 3_600_000);
    const vendas = [
      { doc: 'EX-1001', cpf: '52998224725', valor: 25_000, dia: 2, familia: 'FERRAMENTAS' },
      { doc: 'EX-1002', cpf: '52998224725', valor: 18_000, dia: 20, familia: 'HIDRAULICA' },
      {
        doc: 'EX-1003',
        cpf: '39053344705',
        valor: 60_000,
        dia: 25,
        familia: 'ELETRICA',
        indicacao: aprovado.codigo,
      },
      { doc: 'EX-1004', cpf: cnpj, valor: 320_000, dia: 30, familia: 'CONSTRUCAO' },
      { doc: 'EX-1005', cpf: '52998224725', valor: 9_900, dia: 50, familia: 'ELETRICA' },
    ];
    for (const v of vendas) {
      await processamento.processarVenda(
        {
          lojaCodigoErp: '01',
          documento: v.doc,
          canal: 'LOJA',
          dataVenda: dia(v.dia),
          dataConfirmacao: dia(v.dia),
          compradorDocumento: v.cpf,
          codigoIndicacao: v.indicacao ?? null,
          freteCentavos: 0,
          pagoComCashbackCentavos: 0,
          itens: [
            {
              numeroItem: '1',
              sku: `SKU-${v.familia}`,
              descricao: `Produto fictício ${v.familia}`,
              familia: v.familia,
              subfamilia: `${v.familia}-01`,
              tipo: 'MERCADORIA',
              quantidade: '1',
              valorBrutoCentavos: v.valor,
              descontoCentavos: 0,
            },
          ],
        },
        null,
        SISTEMA,
      );
    }
    await livro.liberarPendentes();
    await app.close();
    console.log(
      `✔ dados fictícios: 3 pessoas, 1 empresa, prestador ${aprovado.codigo}, ${vendas.length} vendas`,
    );
  }
  await prisma.$disconnect();
  if (SENHA_ADMIN === 'Trocar@Agora123')
    console.warn(
      '⚠ admin@cdc.local usa a senha padrão do seed — defina SEED_SENHA_ADMIN em produção.',
    );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
