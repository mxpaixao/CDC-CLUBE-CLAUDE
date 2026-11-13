import { formatarBps, formatarBRL } from '@cdc/shared';
import type { ConfiguracaoVigente } from './configuracao';

export interface SecaoRegra {
  titulo: string;
  itens: string[];
}

/** "Regras do Clube" em linguagem simples, geradas da configuração vigente (nada fixo no texto). */
export function gerarRegrasEmLinguagemSimples(config: ConfiguracaoVigente): SecaoRegra[] {
  const cpf = config.perfis.CLIENTE_CPF.parametros;
  const pj = config.perfis.CLIENTE_EMPRESA.parametros;
  const prog = config.programa.parametros;
  const cli = prog.carteiras.CLIENTE;
  const pre = prog.carteiras.PRESTADOR;
  const ind = prog.indicacao;

  const secoes: SecaoRegra[] = [
    {
      titulo: 'Como você ganha',
      itens: [
        `Clientes pessoa física ganham ${formatarBps(cpf.cashbackBps)} de volta em crédito CDC nas compras a partir de ${formatarBRL(cpf.compraMinimaCentavos)}.`,
        `Empresas (CNPJ) ganham ${formatarBps(pj.cashbackBps)} de volta nas compras a partir de ${formatarBRL(pj.compraMinimaCentavos)}.`,
        ...(cpf.boasVindas
          ? [
              `Boas-vindas: na sua primeira compra após entrar no Clube, o cashback vale em dobro (até ${formatarBps(cpf.boasVindas.tetoBps)}).`,
            ]
          : []),
        'O cálculo considera o valor pago em mercadorias, já com descontos. Frete, serviços e a parte paga com crédito do Clube não entram na conta.',
        'Algumas famílias de produtos e campanhas podem ter percentuais diferentes, indicados na loja e no app.',
      ],
    },
    {
      titulo: 'Quando o crédito fica disponível e quando vence',
      itens: [
        `O crédito é liberado ${cli.carenciaDias} dias após a confirmação da compra.`,
        `Depois de liberado, o crédito vale por ${cli.validadeDias} dias. Avisamos antes de vencer.`,
        'O crédito que vence primeiro é sempre o primeiro a ser usado.',
      ],
    },
    {
      titulo: 'Como usar',
      itens: [
        `Use a partir de ${formatarBRL(cli.saldoMinimoResgateCentavos)} de saldo disponível.`,
        `Em cada compra, o crédito pode pagar até ${formatarBps(cli.limiteUsoBps)} do valor da compra.`,
        'No caixa, informe seu CPF/CNPJ ou mostre o código do app.',
        'Se uma compra for devolvida, o crédito gerado por ela é ajustado. Se o crédito já tiver sido usado, o valor é descontado dos próximos créditos e novos resgates ficam suspensos até a quitação.',
      ],
    },
    {
      titulo: 'Prestadores de serviço CDC',
      itens: [
        `Indicou, ganhou: ${formatarBps(ind.bpsPorNivel.BRONZE)} (Bronze), ${formatarBps(ind.bpsPorNivel.PRATA)} (Prata) ou ${formatarBps(ind.bpsPorNivel.OURO)} (Ouro) do valor da venda indicada, em crédito CDC.`,
        'Informe seu código antes de fechar a venda. Cada venda tem um único indicador.',
        `A indicação vale por ${ind.vinculoDias} dias a partir da primeira compra do cliente com o seu código.`,
        `Limite de ${formatarBRL(ind.tetoMensalCentavos)} em recompensas por mês. O crédito do prestador vale ${pre.validadeDias} dias após liberado.`,
        'Nas suas compras próprias vale a tabela profissional (meio de campo), sem cashback.',
        'Autoindicação não gera recompensa.',
      ],
    },
  ];
  return secoes;
}
