# Layout de importação (ERP → Clube CDC)

Arquivo **CSV** (separador `;`, UTF-8) ou **XLSX** (primeira aba). **Uma linha por item**. Campos do documento (comprador, frete, pagamento com cashback…) se repetem em todas as linhas do mesmo documento.

Os nomes abaixo são os **campos internos**. Se o relatório do ERP usa outros nomes de coluna, ajuste o mapeamento em _Painel → Importação e conciliação → Mapeamento de colunas_ (sem mudar código).

## Colunas

| Campo                      | Obrigatório                | Exemplo                                 | Observação                                                             |
| -------------------------- | -------------------------- | --------------------------------------- | ---------------------------------------------------------------------- |
| `tipo_movimento`           | não (padrão `VENDA`)       | `VENDA`, `DEVOLUCAO`, `CANCELAMENTO`    |                                                                        |
| `loja`                     | **sim**                    | `01`                                    | código da loja no ERP (`01`…`04`)                                      |
| `documento`                | **sim**                    | `123456`                                | nº da NF/cupom. Em devolução: nº do documento de devolução             |
| `documento_origem`         | em devolução               | `123456`                                | venda original. Em `CANCELAMENTO`, se vazio, usa o próprio `documento` |
| `data`                     | **sim**                    | `10/03/2026 14:35`                      | fuso de Manaus. Sem hora = 12:00                                       |
| `data_confirmacao`         | não                        | `10/03/2026 15:00`                      | se vazio = `data`. A carência conta daqui                              |
| `canal`                    | não (padrão `LOJA`)        | `LOJA`, `TELEVENDAS`, `APP`             |                                                                        |
| `comprador_documento`      | recomendado                | `529.982.247-25` / `11.222.333/0001-81` | CPF ou CNPJ (aceita CNPJ alfanumérico). Vazio = venda sem participante |
| `comprador_cpf_autorizado` | não                        |                                         | quem comprou em nome da empresa (antifraude)                           |
| `codigo_indicacao`         | não                        | `CDC-JOAO27`                            | código do prestador informado **antes** de fechar a venda              |
| `vendedor`                 | não                        | `MARCOS`                                | vendedor CDC (papel separado do comprador e do prestador)              |
| `tabela_preco`             | não                        | `MEIO_DE_CAMPO`                         | tabela profissional → compra própria do prestador, sem cashback        |
| `item`                     | **sim**                    | `1`                                     | nº do item no documento (único por documento)                          |
| `sku`                      | **sim** em venda           | `COR-A32`                               |                                                                        |
| `descricao`                | não                        | `Correia A32`                           |                                                                        |
| `familia` / `subfamilia`   | recomendado                | `CORREIAS` / `CORREIAS-V`               | base das regras por família/subfamília                                 |
| `tipo_item`                | não (padrão `MERCADORIA`)  | `MERCADORIA`, `SERVICO`, `FRETE`        | serviço e frete ficam fora da base                                     |
| `quantidade`               | não (padrão 1)             | `2,5`                                   | usada para devolução proporcional                                      |
| `valor_bruto`              | **sim** em venda           | `1.234,56`                              | total do item antes do desconto                                        |
| `desconto`                 | não (padrão 0)             | `10,00`                                 | desconto do item                                                       |
| `valor_liquido`            | não                        | `1.224,56`                              | se informado, precisa bater com bruto − desconto                       |
| `custo`                    | não                        | `800,00`                                | habilita o alerta de margem mínima                                     |
| `em_promocao`              | não                        | `S` / `N`                               | matriz de combinações                                                  |
| `desconto_negociado`       | não                        | `S` / `N`                               | matriz de combinações                                                  |
| `frete`                    | não                        | `25,00`                                 | frete do documento (fora da base)                                      |
| `pago_cashback`            | não                        | `15,00`                                 | parcela paga com crédito do Clube (não gera novo crédito)              |
| `codigo_resgate`           | quando `pago_cashback` > 0 | `R7K4M9P2`                              | código gerado na tela de caixa — concilia com a reserva                |

Valores: até 2 casas decimais (`10,555` é recusado). Separador decimal configurável (vírgula ou ponto).

## Exemplo

[`exemplos/vendas-exemplo.csv`](exemplos/vendas-exemplo.csv)

```csv
tipo_movimento;loja;documento;documento_origem;data;comprador_documento;codigo_indicacao;tabela_preco;item;sku;familia;tipo_item;quantidade;valor_bruto;desconto;frete;pago_cashback;codigo_resgate
VENDA;01;500100;;10/03/2026 14:35;52998224725;;;1;COR-A32;CORREIAS;MERCADORIA;2;180,00;0;15,00;;
VENDA;01;500100;;10/03/2026 14:35;52998224725;;;2;MONT-01;SERVICOS;SERVICO;1;40,00;0;15,00;;
VENDA;02;500101;;10/03/2026 15:10;11144477735;CDC-JOAO27;;1;CAB-10;ELETRICA;MERCADORIA;100;350,00;20,00;;;
DEVOLUCAO;01;DV-900;500100;12/03/2026 09:00;;;;1;COR-A32;;;1;90,00;;;;
```

## Regras de processamento

1. **Idempotência**: venda = `loja + documento`; item = `loja + documento + item`; devolução = `loja + documento de devolução`. Reimportar o mesmo arquivo não duplica nada (o painel avisa "arquivo já importado em…").
2. Cada documento é processado **isoladamente**: um documento com erro não impede os demais. Erros aparecem por linha.
3. Vendas são processadas antes das devoluções do mesmo arquivo. Devolução de venda ainda não importada vira divergência e é reprocessada pela conciliação diária quando a venda chegar.
4. Devolução sem `valor_bruto`/`valor_liquido` é calculada pela proporção de `quantidade`.
5. Pasta monitorada no servidor: `dados/importacoes/entrada` (processada a cada 5 min; arquivos vão para `processados/` ou `erros/`). Falha na importação automática ativa a **contingência**.
