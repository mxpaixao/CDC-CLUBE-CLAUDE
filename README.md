# Clube CDC — Fase 1 (piloto)

Programa de fidelidade e comunidade da **Casa das Correias** (Manaus/AM): cashback para clientes CPF e empresas, recompensa por indicação para prestadores de serviço, caixa sem integração em tempo real (código de resgate) e importação de vendas do ERP por arquivo.

| Área                | Endereço      | Para quem                                             |
| ------------------- | ------------- | ----------------------------------------------------- |
| PWA do participante | `/app`        | clientes, empresas e prestadores (mobile, instalável) |
| Painel CDC          | `/painel`     | caixa, cadastro, comercial, marketing, administração  |
| Link de indicação   | `/i/CDC-XXXX` | página pública do código do prestador                 |
| API + OpenAPI       | `/api/docs`   | integrações                                           |

## Estrutura

```
packages/shared   dinheiro em centavos (BigInt), CPF/CNPJ (inclui alfanumérico), fuso Manaus, schemas zod
packages/rules    motor de regras PURO (sem I/O) — cálculo, precedência, devolução, FIFO, antifraude
apps/api          NestJS + Prisma/PostgreSQL + BullMQ/Redis (worker de jobs)
apps/web          Next.js (App Router): /app e /painel
e2e               Playwright (fluxos do painel, caixa e app)
infra             nginx (TLS) e backup do Postgres
docs              DECISOES, OPERACAO, LAYOUT_IMPORTACAO
```

## Rodar em desenvolvimento

Pré-requisitos: Node 22, pnpm 10, PostgreSQL 16, Redis 7.

```bash
pnpm install
```

```bash
cp apps/api/.env.example apps/api/.env
```

```bash
pnpm build:libs && pnpm --filter @cdc/api build
```

```bash
cd apps/api && npx prisma migrate deploy && SEED_EXEMPLOS=true node dist/prisma/seed.js
```

```bash
node apps/api/dist/src/main.js
```

```bash
pnpm --filter @cdc/web dev
```

Abra `http://localhost:3000`. Login do painel: `admin@cdc.local` / senha definida em `SEED_SENHA_ADMIN` (padrão do seed: `Trocar@Agora123`). Usuários de exemplo (`caixa@`, `gerente@`, `marketing@cdc.local`) usam `SEED_SENHA_EXEMPLO` (padrão `Exemplo@CDC2026`). Com `NOTIFICADOR=console`, os códigos OTP aparecem no log da API.

Worker de jobs (liberação, vencimento, expiração de reservas, lembretes, conciliação, pasta monitorada):

```bash
node apps/api/dist/src/worker.js
```

> O seed e o worker usam o código **compilado** (`dist`): a injeção de dependências do NestJS depende de metadata de decorators que o `tsx` não emite.

## Testes

```bash
pnpm test
```

Roda: `shared` (19), `rules` (47 — inclui os **20 cenários de aceite** da seção 11, cobertura mínima 90% aplicada no CI; hoje 100% linhas / 98,6% ramos) e `api` (32 testes de integração contra PostgreSQL real em `clube_cdc_test`, incluindo concorrência de reservas e imutabilidade do livro-razão).

E2E (precisa do build da API e da web e de um banco `clube_cdc_e2e`):

```bash
pnpm --filter @cdc/api build && pnpm --filter @cdc/web build && pnpm e2e
```

O preparo do banco E2E só executa em bancos cujo nome termina com `_e2e` ou `_test`.

## Produção (servidor da CDC)

```bash
cp .env.producao.exemplo .env
```

Preencha `POSTGRES_PASSWORD` e `JWT_SECRET` (o compose recusa subir sem eles). Certificado TLS: copie o da CDC para `infra/nginx/certs/clube.crt|.key` ou gere um provisório:

```bash
./infra/nginx/gerar-certificado.sh clube.casadascorreias.com.br
```

```bash
docker compose up -d --build
```

```bash
docker compose exec -e SEED_SENHA_ADMIN='senha-forte-aqui' api node dist/prisma/seed.js
```

Serviços: `postgres`, `redis`, `api` (aplica migrations na subida), `worker`, `web`, `nginx` (80→443) e `backup` (pg_dump diário às 02:30 de Manaus, retenção de 30 dias em `./backups`). Rotina de operação, backup/restauração e contingência: [`docs/OPERACAO.md`](docs/OPERACAO.md).

## Regras inegociáveis — onde estão garantidas

| Regra                                  | Implementação                                                                                                        |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Nenhuma regra comercial fixa no código | `Regra`/`RegraVersao` versionadas, validadas por zod, editáveis no painel; o seed v1 só preenche a tabela            |
| Dinheiro em centavos, floor no crédito | `packages/shared/src/dinheiro.ts` (BigInt, floor único por venda); lint bloqueia `Math.round(x * y)`                 |
| Livro-razão imutável                   | trigger no Postgres (`lancamento`, `auditoria`, `regra_versao`, `consentimento` append-only)                         |
| Idempotência                           | chaves únicas (loja+documento+item, `cashback:`, `indicacao:`, `resgate:`), header `Idempotency-Key` em toda escrita |
| Nunca escrever no ERP                  | porta `ErpGateway` só lê (`ImportacaoArquivoAdapter`; `ShxApiAdapter` é stub)                                        |
| LGPD                                   | consentimentos separados e versionados, exclusão com anonimização, dados mínimos ao prestador, auditoria             |

Decisões e dúvidas em aberto: [`docs/DECISOES.md`](docs/DECISOES.md).
