# Manual de operação — Clube CDC (Fase 1)

## 1. Rotina do caixa (`/painel/caixa`)

**Antes de fechar a venda — indicação de prestador**

1. Cliente chegou com código/QR de prestador? Em **Indicação de prestador**, informe o nº do orçamento/pedido e o código (`CDC-JOAO27`). Um indicador por venda.
2. Alternativa: digitar o código no campo de observação/indicação do ERP (vai na coluna `codigo_indicacao` da exportação).
3. Depois de fechada a venda, troca de indicador só no painel, por usuário com `ajuste_saldo`, com justificativa (fica na auditoria).

**Cliente quer usar o saldo**

1. Busque por CPF, CNPJ, telefone ou leia o QR do app. Informe o **valor da compra em mercadorias** (sem frete/serviços).
2. Escolha a carteira. A tela mostra saldo, limite (20% da compra) e o máximo utilizável. Bloqueios aparecem em vermelho (saldo devedor, saldo abaixo de R$ 5,00, prestador suspenso).
3. Carteira de **prestador**: clique em _Enviar código ao titular_ e digite o código de 6 dígitos que ele recebeu. Cliente pode, opcionalmente, mostrar o código do app.
4. **Reservar** → anote o **código de resgate** (ex.: `R7K4M9P2`).
5. No ERP, lance o valor como forma de pagamento **“Crédito Clube CDC”** e registre o código.
6. **Confirmar resgate** (informe o nº do documento do ERP, se já houver). Desistiu? **Cancelar** — o saldo volta na hora.
7. Reserva não confirmada expira em **30 minutos** e o saldo volta sozinho.

> A importação do ERP confirma automaticamente reservas ainda ativas cujo código aparece na venda, e aponta divergências quando o código não existe, já expirou ou o valor difere.

**Cadastro na loja** (`/painel/clientes` → _Cadastrar cliente na loja_): o cliente recebe um código no celular e o informa ao atendente — é a prova do consentimento. Pergunte separadamente se aceita avisos por WhatsApp/SMS.

## 2. Importação de vendas (`/painel/importacao`)

- **Diária**, após o fechamento: exporte do ERP o relatório de vendas, devoluções e cancelamentos no [layout](LAYOUT_IMPORTACAO.md) e faça o upload — ou deixe o arquivo em `dados/importacoes/entrada` no servidor (processado a cada 5 min).
- Pode reimportar sem medo: nada é duplicado.
- Confira o resultado: vendas novas, já importadas, devoluções e **erros por linha**. Corrija na origem e reimporte só as linhas com erro (ou o arquivo inteiro).
- O crédito nasce **pendente** e é liberado às 00:00 (Manaus) do 7º dia após a confirmação da venda.

## 3. Conciliação (`/painel/importacao` → Divergências)

Roda todo dia às 06:00 (ou no botão _Executar conciliação agora_). Tipos:

| Divergência                                                  | O que fazer                                                                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RESERVA_SEM_VENDA`                                          | Resgate confirmado no caixa sem venda importada. Verifique se a venda foi lançada no ERP; se não foi, faça ajuste manual de crédito ao cliente com o motivo. |
| `PAGAMENTO_CASHBACK_SEM_CODIGO`                              | ERP registrou pagamento com cashback sem código: identifique a reserva e corrija o lançamento no ERP.                                                        |
| `CODIGO_RESGATE_DESCONHECIDO` / `RESGATE_SEM_RESERVA_VALIDA` | **Alta prioridade**: desconto concedido no ERP sem débito no Clube. Apure com a loja; se devido, ajuste negativo no saldo do cliente com motivo.             |
| `VALOR_RESGATE_DIVERGENTE`                                   | Valor da reserva ≠ valor no ERP. Ajuste a diferença com motivo.                                                                                              |
| `CODIGO_RESGATE_REUTILIZADO`                                 | Mesmo código em duas vendas — apurar.                                                                                                                        |
| `DEVOLUCAO_SEM_VENDA`                                        | Devolução chegou antes da venda; resolve-se sozinha quando a venda for importada.                                                                            |

Marque cada item como **resolvido** ou **ignorado** com a explicação — fica auditado.

**Alertas** (mesma tela, aba _Alertas_): autoindicação bloqueada, padrões suspeitos de prestador (comprador repetido, valores redondos, muitas canceladas), teto mensal atingido e piso de margem (Fase 1: só alerta).

## 4. Contingência

Ativada automaticamente quando a importação automática falha ou não há importação bem-sucedida há 48 h (configurável), ou manualmente em _Usuários e auditoria → Sistema_.

Efeitos: **liberação de créditos pausada** e **resgates exigem liberação de supervisor** (usuário `admin`, com justificativa). Para encerrar: confirme que as importações voltaram, rode a conciliação e clique em _Encerrar contingência_ informando o que foi verificado. Os créditos represados são liberados no próximo ciclo.

## 5. Jobs agendados (worker, fuso America/Manaus)

| Job                   | Quando          | Função                                                        |
| --------------------- | --------------- | ------------------------------------------------------------- |
| `liberar-creditos`    | de hora em hora | PENDENTE → DISPONIVEL; abate saldo devedor                    |
| `vencer-creditos`     | 00:10           | DISPONIVEL → VENCIDO (preserva o que está reservado)          |
| `expirar-reservas`    | a cada minuto   | formaliza reservas expiradas                                  |
| `lembretes`           | 08:00           | "vence em 7 dias", "último dia", reativação após 45 dias      |
| `enviar-notificacoes` | a cada 5 min    | envia a fila respeitando consentimento e horário comercial    |
| `conciliacao`         | 06:00           | cruza vendas × reservas × devoluções; checa integração parada |
| `importar-pasta`      | a cada 5 min    | pasta monitorada                                              |
| `antifraude`          | 06:30           | padrões suspeitos por prestador                               |
| `niveis-prestador`    | dia 1, 03:00    | recálculo automático (desligado na Fase 1)                    |

Todos são idempotentes. Execução manual: _Usuários e auditoria → Sistema_.

## 6. Backup e restauração

- Serviço `backup` do compose: `pg_dump` diário às **02:30** (Manaus), formato custom comprimido, com verificação (`pg_restore --list`) e `sha256`. Retenção: **30 dias** em `./backups` (`BACKUP_PASTA`).
- **Copie a pasta de backups para fora do servidor** (NAS/nuvem) diariamente — backup no mesmo disco não protege contra falha do disco.
- Backup imediato:

```bash
docker compose exec backup bash /backup.sh agora
```

- Restauração (substitui o banco atual — pare `api` e `worker` antes):

```bash
docker compose stop api worker
```

```bash
docker compose exec backup bash /backup.sh restaurar /backups/clube_cdc_AAAA-MM-DD_HHMM.dump
```

```bash
docker compose start api worker
```

- Teste uma restauração em ambiente separado **todo mês**.

## 7. Logs e monitoramento

- API/worker: logs JSON estruturados (pino) sem dados sensíveis (`authorization`, cookies, senhas e códigos OTP são omitidos). `docker compose logs -f api worker`.
- nginx: access log em JSON. Limite de 10 envios de OTP por minuto por IP.
- Saúde: `GET /api/saude` (usado pelo healthcheck do container).

## 8. Segurança

- Troque a senha do `admin@cdc.local` e dos usuários de exemplo na implantação; crie um usuário por pessoa com o mínimo de permissões.
- `JWT_SECRET` com 64+ caracteres aleatórios; `.env` fora do controle de versão.
- WhatsApp: com `NOTIFICADOR=whatsapp`, configure `WHATSAPP_API_URL`/`WHATSAPP_API_TOKEN`. Mensagens fora da janela de 24 h exigem **templates aprovados** pela Meta — os textos do painel precisam ser cadastrados lá com o mesmo conteúdo.
- LGPD: pedidos de exclusão são feitos pelo próprio titular no app (_Perfil → Excluir conta_) ou pela equipe; dados pessoais são anonimizados e o livro-razão é mantido sem identificação.
