import { Prisma, PrismaClient } from '@prisma/client';
import { MATRIZ_V1, NIVEL_PRESTADOR_V1, PERFIS_V1, PROGRAMA_V1 } from '@cdc/rules';
import { ESPECIALIDADES_PADRAO, PERMISSOES, type PerfilComercial } from '@cdc/shared';
import * as argon2 from 'argon2';

export const LOJAS_SEED = [
  { id: 'LOJA-01', codigoErp: '01', nome: 'CDC Matriz — Centro' },
  { id: 'LOJA-02', codigoErp: '02', nome: 'CDC Distrito Industrial' },
  { id: 'LOJA-03', codigoErp: '03', nome: 'CDC Cidade Nova' },
  { id: 'LOJA-04', codigoErp: '04', nome: 'CDC Ponta Negra' },
];

const DESCRICAO_PERMISSOES: Record<string, string> = {
  cadastro: 'Cadastrar e editar clientes e empresas',
  operacao_caixa: 'Consultar saldo, reservar, confirmar e cancelar resgates no caixa',
  alteracao_regras: 'Criar versões de regras, campanhas, matriz e pisos de margem',
  ajuste_saldo: 'Lançar ajustes manuais de saldo e alterar indicador de venda',
  aprovacao_prestador: 'Aprovar, recusar, suspender prestadores e definir nível',
  visualizacao_relatorios: 'Ver visão geral, relatórios, importações e conciliação',
  admin: 'Acesso total, usuários, contingência e auditoria',
};

export const TEMPLATES_SEED = [
  {
    codigo: 'CREDITO_LIBERADO',
    titulo: 'Crédito liberado',
    corpo:
      'Clube CDC: R$ {{valor}} de crédito já estão disponíveis para usar nas lojas CDC. Use até {{validade}} dias.',
    marketing: true,
  },
  {
    codigo: 'VENCE_EM_DIAS',
    titulo: 'Crédito vencendo',
    corpo:
      'Clube CDC: R$ {{valor}} do seu crédito vencem em {{dias}} dias ({{data}}). Aproveite na sua próxima compra!',
    marketing: true,
  },
  {
    codigo: 'ULTIMO_DIA',
    titulo: 'Último dia',
    corpo: 'Clube CDC: hoje é o último dia para usar R$ {{valor}} de crédito. Passe numa loja CDC!',
    marketing: true,
  },
  {
    codigo: 'REATIVACAO',
    titulo: 'Sentimos sua falta',
    corpo:
      'Clube CDC: sentimos sua falta! Volte a comprar e continue ganhando crédito em cada compra.',
    marketing: true,
  },
  {
    codigo: 'PRESTADOR_VENDA_CONFIRMADA',
    titulo: 'Venda indicada confirmada',
    corpo:
      'Clube CDC: uma venda indicada por você foi confirmada. Recompensa prevista: R$ {{valor}} (liberação em {{carencia}} dias).',
    marketing: true,
  },
  {
    codigo: 'PRESTADOR_RECOMPENSA_LIBERADA',
    titulo: 'Recompensa liberada',
    corpo: 'Clube CDC: R$ {{valor}} de recompensa por indicação já estão disponíveis.',
    marketing: true,
  },
  {
    codigo: 'PRESTADOR_APROVADO',
    titulo: 'Cadastro aprovado',
    corpo:
      'Clube CDC: seu cadastro de prestador foi aprovado! Seu código é {{codigo}}. Compartilhe: {{link}}',
    marketing: true,
  },
];

export const MAPEAMENTO_PADRAO: Record<string, string> = {
  tipo_movimento: 'tipo_movimento',
  loja: 'loja',
  documento: 'documento',
  documento_origem: 'documento_origem',
  data: 'data',
  data_confirmacao: 'data_confirmacao',
  canal: 'canal',
  comprador_documento: 'comprador_documento',
  comprador_nome: 'comprador_nome',
  comprador_telefone: 'comprador_telefone',
  comprador_cpf_autorizado: 'comprador_cpf_autorizado',
  codigo_indicacao: 'codigo_indicacao',
  vendedor: 'vendedor',
  tabela_preco: 'tabela_preco',
  item: 'item',
  sku: 'sku',
  descricao: 'descricao',
  familia: 'familia',
  subfamilia: 'subfamilia',
  tipo_item: 'tipo_item',
  quantidade: 'quantidade',
  valor_bruto: 'valor_bruto',
  desconto: 'desconto',
  valor_liquido: 'valor_liquido',
  custo: 'custo',
  em_promocao: 'em_promocao',
  desconto_negociado: 'desconto_negociado',
  frete: 'frete',
  pago_cashback: 'pago_cashback',
  codigo_resgate: 'codigo_resgate',
};

export async function semearBase(prisma: PrismaClient, implantacao: Date, senhaAdmin: string) {
  for (const codigo of PERMISSOES) {
    await prisma.permissao.upsert({
      where: { codigo },
      create: { codigo, descricao: DESCRICAO_PERMISSOES[codigo] },
      update: {},
    });
  }
  for (const l of LOJAS_SEED)
    await prisma.loja.upsert({ where: { id: l.id }, create: l, update: {} });
  for (const id of ESPECIALIDADES_PADRAO) {
    const nome =
      id === 'refrigeracao'
        ? 'Refrigeração'
        : id === 'mecanico_industrial'
          ? 'Mecânico industrial'
          : id.charAt(0).toUpperCase() + id.slice(1);
    await prisma.especialidade.upsert({ where: { id }, create: { id, nome }, update: {} });
  }
  for (const t of TEMPLATES_SEED)
    await prisma.templateNotificacao.upsert({ where: { codigo: t.codigo }, create: t, update: {} });
  await prisma.mapeamentoImportacao.upsert({
    where: { nome: 'Padrão CDC (layout docs/LAYOUT_IMPORTACAO.md)' },
    create: {
      nome: 'Padrão CDC (layout docs/LAYOUT_IMPORTACAO.md)',
      colunas: MAPEAMENTO_PADRAO,
      padrao: true,
    },
    update: {},
  });

  const admin = await prisma.usuarioCdc.upsert({
    where: { email: 'admin@cdc.local' },
    create: {
      nome: 'Administrador CDC',
      email: 'admin@cdc.local',
      senhaHash: await argon2.hash(senhaAdmin, { type: argon2.argon2id }),
      permissoes: ['admin'],
    },
    update: {},
  });

  // ── Regras v1 (seção 3 do escopo)
  const regras: {
    escopo: Prisma.RegraCreateInput['escopo'];
    chave: string;
    nome: string;
    perfil?: PerfilComercial;
    parametros: unknown;
  }[] = [
    {
      escopo: 'PROGRAMA',
      chave: 'PROGRAMA',
      nome: 'Parâmetros do programa',
      parametros: PROGRAMA_V1,
    },
    {
      escopo: 'PERFIL',
      chave: 'PERFIL:CLIENTE_CPF',
      nome: 'Cliente CPF',
      perfil: 'CLIENTE_CPF',
      parametros: PERFIS_V1.CLIENTE_CPF,
    },
    {
      escopo: 'PERFIL',
      chave: 'PERFIL:CLIENTE_EMPRESA',
      nome: 'Cliente Empresa',
      perfil: 'CLIENTE_EMPRESA',
      parametros: PERFIS_V1.CLIENTE_EMPRESA,
    },
    {
      escopo: 'PERFIL',
      chave: 'PERFIL:PRESTADOR',
      nome: 'Prestador (compra própria)',
      perfil: 'PRESTADOR',
      parametros: PERFIS_V1.PRESTADOR,
    },
    { escopo: 'MATRIZ', chave: 'MATRIZ', nome: 'Matriz de combinações', parametros: MATRIZ_V1 },
    {
      escopo: 'NIVEL_PRESTADOR',
      chave: 'NIVEL_PRESTADOR',
      nome: 'Critérios de nível do prestador',
      parametros: NIVEL_PRESTADOR_V1,
    },
  ];
  for (const r of regras) {
    const regra = await prisma.regra.upsert({
      where: { chave: r.chave },
      create: { escopo: r.escopo, chave: r.chave, nome: r.nome, perfil: r.perfil ?? null },
      update: {},
    });
    const existe = await prisma.regraVersao.findFirst({ where: { regraId: regra.id } });
    if (!existe) {
      await prisma.regraVersao.create({
        data: {
          regraId: regra.id,
          versao: 1,
          parametros: r.parametros as Prisma.InputJsonValue,
          vigenciaInicio: implantacao,
          autorId: admin.id,
          motivo: 'Configuração v1 aprovada (seed de implantação)',
        },
      });
    }
  }
  return { admin };
}
