-- CreateEnum
CREATE TYPE "TipoParticipante" AS ENUM ('CPF', 'EMPRESA');

-- CreateEnum
CREATE TYPE "StatusParticipante" AS ENUM ('ATIVO', 'INATIVO', 'EXCLUIDO');

-- CreateEnum
CREATE TYPE "StatusPrestador" AS ENUM ('PENDENTE', 'APROVADO', 'RECUSADO', 'SUSPENSO');

-- CreateEnum
CREATE TYPE "NivelPrestador" AS ENUM ('BRONZE', 'PRATA', 'OURO');

-- CreateEnum
CREATE TYPE "TipoCarteira" AS ENUM ('CLIENTE', 'PRESTADOR');

-- CreateEnum
CREATE TYPE "TipoLancamento" AS ENUM ('CREDITO', 'DEBITO', 'ESTORNO', 'AJUSTE', 'VENCIMENTO');

-- CreateEnum
CREATE TYPE "OrigemLancamento" AS ENUM ('COMPRA', 'BOAS_VINDAS', 'INDICACAO', 'CAMPANHA', 'AJUSTE_MANUAL', 'ESTORNO', 'VENCIMENTO', 'RESGATE', 'QUITACAO_SALDO_DEVEDOR', 'DEVOLUCAO_CASHBACK_UTILIZADO');

-- CreateEnum
CREATE TYPE "EstadoLancamento" AS ENUM ('PENDENTE', 'DISPONIVEL', 'RESGATADO', 'VENCIDO', 'ESTORNADO', 'EFETIVADO');

-- CreateEnum
CREATE TYPE "StatusReserva" AS ENUM ('ATIVA', 'CONFIRMADA', 'CANCELADA', 'EXPIRADA');

-- CreateEnum
CREATE TYPE "PerfilComercial" AS ENUM ('CLIENTE_CPF', 'CLIENTE_EMPRESA', 'PRESTADOR');

-- CreateEnum
CREATE TYPE "TipoItem" AS ENUM ('MERCADORIA', 'SERVICO', 'FRETE');

-- CreateEnum
CREATE TYPE "StatusVenda" AS ENUM ('CONFIRMADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "TipoDevolucao" AS ENUM ('DEVOLUCAO', 'CANCELAMENTO');

-- CreateEnum
CREATE TYPE "EscopoRegra" AS ENUM ('PROGRAMA', 'PERFIL', 'LOJA_CANAL', 'CAMPANHA', 'FAMILIA', 'SUBFAMILIA', 'PRODUTO', 'MATRIZ', 'PISO_MARGEM', 'NIVEL_PRESTADOR');

-- CreateEnum
CREATE TYPE "StatusDivergencia" AS ENUM ('ABERTA', 'RESOLVIDA', 'IGNORADA');

-- CreateEnum
CREATE TYPE "StatusAlerta" AS ENUM ('ABERTO', 'ANALISADO', 'DESCARTADO');

-- CreateEnum
CREATE TYPE "StatusImportacao" AS ENUM ('PROCESSANDO', 'CONCLUIDA', 'CONCLUIDA_COM_ERROS', 'FALHOU');

-- CreateEnum
CREATE TYPE "StatusNotificacao" AS ENUM ('PENDENTE', 'ENVIADA', 'FALHOU', 'CANCELADA', 'BLOQUEADA_CONSENTIMENTO');

-- CreateEnum
CREATE TYPE "CanalNotificacao" AS ENUM ('WHATSAPP', 'SMS', 'PUSH', 'EMAIL', 'CONSOLE');

-- CreateTable
CREATE TABLE "pessoa" (
    "id" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "telefone" TEXT,
    "email" TEXT,
    "dataNascimento" DATE,
    "anonimizadaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pessoa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "empresa" (
    "id" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "razaoSocial" TEXT NOT NULL,
    "nomeFantasia" TEXT,
    "telefone" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "empresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "empresa_comprador" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "pessoaId" TEXT NOT NULL,
    "papel" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "empresa_comprador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participante" (
    "id" TEXT NOT NULL,
    "tipo" "TipoParticipante" NOT NULL,
    "pessoaId" TEXT,
    "empresaId" TEXT,
    "status" "StatusParticipante" NOT NULL DEFAULT 'ATIVO',
    "dataAdesao" TIMESTAMP(3) NOT NULL,
    "boasVindasVendaId" TEXT,
    "ultimaCompraEm" TIMESTAMP(3),
    "canalAdesao" TEXT NOT NULL DEFAULT 'APP',
    "excluidoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "participante_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consentimento" (
    "id" TEXT NOT NULL,
    "pessoaId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "concedido" BOOLEAN NOT NULL,
    "versaoTermo" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "ip" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consentimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "especialidade" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "especialidade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prestador" (
    "id" TEXT NOT NULL,
    "pessoaId" TEXT NOT NULL,
    "cnpj" TEXT,
    "razaoSocial" TEXT,
    "status" "StatusPrestador" NOT NULL DEFAULT 'PENDENTE',
    "nivel" "NivelPrestador" NOT NULL DEFAULT 'BRONZE',
    "nivelDefinidoManual" BOOLEAN NOT NULL DEFAULT false,
    "codigo" TEXT,
    "especialidades" TEXT[],
    "bairros" TEXT[],
    "whatsapp" TEXT,
    "fotos" TEXT[],
    "documentos" TEXT[],
    "termosAceitosEm" TIMESTAMP(3),
    "codigoCondutaAceitoEm" TIMESTAMP(3),
    "aprovadoPorId" TEXT,
    "aprovadoEm" TIMESTAMP(3),
    "motivoStatus" TEXT,
    "perfilPublico" BOOLEAN NOT NULL DEFAULT false,
    "descricaoPublica" TEXT,
    "seloRecomendado" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prestador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "avaliacao" (
    "id" TEXT NOT NULL,
    "prestadorId" TEXT NOT NULL,
    "vendaId" TEXT NOT NULL,
    "nota" INTEGER NOT NULL,
    "comentario" TEXT,
    "publicada" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "avaliacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carteira" (
    "id" TEXT NOT NULL,
    "tipo" "TipoCarteira" NOT NULL,
    "titularChave" TEXT NOT NULL,
    "pessoaId" TEXT,
    "empresaId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "carteira_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lancamento" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "carteiraId" TEXT NOT NULL,
    "tipo" "TipoLancamento" NOT NULL,
    "origem" "OrigemLancamento" NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "estado" "EstadoLancamento" NOT NULL,
    "loteId" TEXT,
    "liberaEm" TIMESTAMP(3),
    "liberadoEm" TIMESTAMP(3),
    "venceEm" TIMESTAMP(3),
    "vendaId" TEXT,
    "devolucaoId" TEXT,
    "reservaId" TEXT,
    "regraVersaoId" TEXT,
    "chaveIdempotencia" TEXT NOT NULL,
    "criadoPor" TEXT NOT NULL,
    "motivo" TEXT,
    "detalhes" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lancamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reserva" (
    "id" TEXT NOT NULL,
    "carteiraId" TEXT NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "valorCompraCentavos" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "status" "StatusReserva" NOT NULL DEFAULT 'ATIVA',
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "lojaId" TEXT NOT NULL,
    "operadorId" TEXT NOT NULL,
    "vendaErpRef" TEXT,
    "vendaId" TEXT,
    "chaveIdempotencia" TEXT NOT NULL,
    "autenticacaoTitular" TEXT,
    "confirmadaEm" TIMESTAMP(3),
    "canceladaEm" TIMESTAMP(3),
    "motivoCancelamento" TEXT,
    "conciliadaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reserva_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reserva_alocacao" (
    "id" TEXT NOT NULL,
    "reservaId" TEXT NOT NULL,
    "loteId" TEXT NOT NULL,
    "valorCentavos" INTEGER NOT NULL,

    CONSTRAINT "reserva_alocacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loja" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cidade" TEXT NOT NULL DEFAULT 'Manaus',
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "codigoErp" TEXT NOT NULL,

    CONSTRAINT "loja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "familia" (
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,

    CONSTRAINT "familia_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "subfamilia" (
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "familiaCodigo" TEXT NOT NULL,

    CONSTRAINT "subfamilia_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "produto" (
    "sku" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "familiaCodigo" TEXT,
    "subfamiliaCodigo" TEXT,
    "precoProfissionalCentavos" INTEGER,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "produto_pkey" PRIMARY KEY ("sku")
);

-- CreateTable
CREATE TABLE "venda" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "canal" TEXT NOT NULL,
    "documentoErp" TEXT NOT NULL,
    "chaveIdempotencia" TEXT NOT NULL,
    "compradorDocumento" TEXT,
    "compradorPessoaId" TEXT,
    "compradorEmpresaId" TEXT,
    "compradorAutorizadoCpf" TEXT,
    "prestadorIndicadorId" TEXT,
    "codigoIndicacaoInformado" TEXT,
    "origemIndicacao" TEXT,
    "vendedorCdc" TEXT,
    "perfilAplicado" "PerfilComercial" NOT NULL,
    "status" "StatusVenda" NOT NULL DEFAULT 'CONFIRMADA',
    "dataVenda" TIMESTAMP(3) NOT NULL,
    "dataConfirmacao" TIMESTAMP(3) NOT NULL,
    "tabelaPreco" TEXT,
    "totalBrutoCentavos" INTEGER NOT NULL,
    "totalDescontosCentavos" INTEGER NOT NULL,
    "freteCentavos" INTEGER NOT NULL DEFAULT 0,
    "servicosCentavos" INTEGER NOT NULL DEFAULT 0,
    "pagoComCashbackCentavos" INTEGER NOT NULL DEFAULT 0,
    "codigoResgate" TEXT,
    "baseCalculoCentavos" INTEGER NOT NULL DEFAULT 0,
    "cashbackCentavos" INTEGER NOT NULL DEFAULT 0,
    "recompensaCalculadaCentavos" INTEGER NOT NULL DEFAULT 0,
    "recompensaCentavos" INTEGER NOT NULL DEFAULT 0,
    "recompensaExcedenteCentavos" INTEGER NOT NULL DEFAULT 0,
    "regraVersaoId" TEXT,
    "calculo" JSONB,
    "importacaoId" TEXT,
    "situacaoCredito" TEXT NOT NULL DEFAULT 'PROCESSADA',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "venda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venda_item" (
    "id" TEXT NOT NULL,
    "vendaId" TEXT NOT NULL,
    "numeroItem" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "descricao" TEXT,
    "familiaCodigo" TEXT,
    "subfamiliaCodigo" TEXT,
    "tipo" "TipoItem" NOT NULL,
    "quantidade" DECIMAL(14,3) NOT NULL,
    "valorBrutoCentavos" INTEGER NOT NULL,
    "descontoCentavos" INTEGER NOT NULL,
    "valorLiquidoCentavos" INTEGER NOT NULL,
    "custoCentavos" INTEGER,
    "emPromocao" BOOLEAN NOT NULL DEFAULT false,
    "descontoNegociado" BOOLEAN NOT NULL DEFAULT false,
    "tabelaProfissional" BOOLEAN NOT NULL DEFAULT false,
    "chaveIdempotencia" TEXT NOT NULL,

    CONSTRAINT "venda_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venda_pagamento" (
    "id" TEXT NOT NULL,
    "vendaId" TEXT NOT NULL,
    "forma" TEXT NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "codigoResgate" TEXT,

    CONSTRAINT "venda_pagamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devolucao" (
    "id" TEXT NOT NULL,
    "vendaId" TEXT NOT NULL,
    "documentoErp" TEXT NOT NULL,
    "tipo" "TipoDevolucao" NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "chaveIdempotencia" TEXT NOT NULL,
    "importacaoId" TEXT,
    "processadaEm" TIMESTAMP(3),
    "resultado" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devolucao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devolucao_item" (
    "id" TEXT NOT NULL,
    "devolucaoId" TEXT NOT NULL,
    "numeroItem" TEXT NOT NULL,
    "quantidade" DECIMAL(14,3) NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "chaveIdempotencia" TEXT NOT NULL,

    CONSTRAINT "devolucao_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vinculo_indicacao" (
    "id" TEXT NOT NULL,
    "compradorChave" TEXT NOT NULL,
    "prestadorId" TEXT NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3) NOT NULL,
    "origem" TEXT NOT NULL,
    "vendaOrigemId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vinculo_indicacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indicacao_pre_registro" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "documentoErp" TEXT NOT NULL,
    "prestadorId" TEXT NOT NULL,
    "operadorId" TEXT NOT NULL,
    "utilizadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "indicacao_pre_registro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campanha" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campanha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regra" (
    "id" TEXT NOT NULL,
    "escopo" "EscopoRegra" NOT NULL,
    "nome" TEXT,
    "perfil" "PerfilComercial",
    "lojaId" TEXT,
    "canal" TEXT,
    "familia" TEXT,
    "subfamilia" TEXT,
    "sku" TEXT,
    "campanhaId" TEXT,
    "chave" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regra_versao" (
    "id" TEXT NOT NULL,
    "regraId" TEXT NOT NULL,
    "versao" INTEGER NOT NULL,
    "parametros" JSONB NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "vigenciaInicio" TIMESTAMP(3) NOT NULL,
    "vigenciaFim" TIMESTAMP(3),
    "autorId" TEXT NOT NULL,
    "motivo" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regra_versao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuario_cdc" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "permissoes" TEXT[],
    "lojaId" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ultimoAcesso" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuario_cdc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissao" (
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,

    CONSTRAINT "permissao_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "auditoria" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT,
    "ator" TEXT NOT NULL,
    "acao" TEXT NOT NULL,
    "entidade" TEXT NOT NULL,
    "entidadeId" TEXT,
    "antes" JSONB,
    "depois" JSONB,
    "motivo" TEXT,
    "ip" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp" (
    "id" TEXT NOT NULL,
    "pessoaId" TEXT,
    "documento" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "finalidade" TEXT NOT NULL,
    "codigoHash" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "utilizadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotencia_requisicao" (
    "chave" TEXT NOT NULL,
    "escopo" TEXT NOT NULL,
    "hashCorpo" TEXT NOT NULL,
    "statusHttp" INTEGER NOT NULL,
    "resposta" JSONB NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotencia_requisicao_pkey" PRIMARY KEY ("chave")
);

-- CreateTable
CREATE TABLE "mapeamento_importacao" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "colunas" JSONB NOT NULL,
    "formatoData" TEXT NOT NULL DEFAULT 'dd/MM/yyyy',
    "separadorDecimal" TEXT NOT NULL DEFAULT 'virgula',
    "delimitadorCsv" TEXT NOT NULL DEFAULT ';',
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mapeamento_importacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "importacao" (
    "id" TEXT NOT NULL,
    "arquivoNome" TEXT NOT NULL,
    "arquivoHash" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "mapeamentoId" TEXT,
    "status" "StatusImportacao" NOT NULL DEFAULT 'PROCESSANDO',
    "linhasTotal" INTEGER NOT NULL DEFAULT 0,
    "linhasOk" INTEGER NOT NULL DEFAULT 0,
    "linhasIgnoradas" INTEGER NOT NULL DEFAULT 0,
    "linhasErro" INTEGER NOT NULL DEFAULT 0,
    "erros" JSONB,
    "resumo" JSONB,
    "usuarioId" TEXT,
    "iniciadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidaEm" TIMESTAMP(3),

    CONSTRAINT "importacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "divergencia" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "severidade" TEXT NOT NULL DEFAULT 'MEDIA',
    "descricao" TEXT NOT NULL,
    "referencia" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "dados" JSONB,
    "status" "StatusDivergencia" NOT NULL DEFAULT 'ABERTA',
    "responsavelId" TEXT,
    "resolucao" TEXT,
    "resolvidaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "divergencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerta" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "severidade" TEXT NOT NULL DEFAULT 'MEDIA',
    "descricao" TEXT NOT NULL,
    "referencia" TEXT,
    "chave" TEXT NOT NULL,
    "dados" JSONB,
    "status" "StatusAlerta" NOT NULL DEFAULT 'ABERTO',
    "analisadoPor" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificacao" (
    "id" TEXT NOT NULL,
    "pessoaId" TEXT,
    "destino" TEXT NOT NULL,
    "canal" "CanalNotificacao" NOT NULL,
    "template" TEXT NOT NULL,
    "dados" JSONB NOT NULL,
    "status" "StatusNotificacao" NOT NULL DEFAULT 'PENDENTE',
    "agendadaPara" TIMESTAMP(3) NOT NULL,
    "enviadaEm" TIMESTAMP(3),
    "erro" TEXT,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "chave" TEXT NOT NULL,
    "marketing" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_notificacao" (
    "codigo" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "corpo" TEXT NOT NULL,
    "marketing" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "template_notificacao_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "estado_sistema" (
    "chave" TEXT NOT NULL,
    "valor" JSONB NOT NULL,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "estado_sistema_pkey" PRIMARY KEY ("chave")
);

-- CreateIndex
CREATE UNIQUE INDEX "pessoa_cpf_key" ON "pessoa"("cpf");

-- CreateIndex
CREATE INDEX "pessoa_telefone_idx" ON "pessoa"("telefone");

-- CreateIndex
CREATE UNIQUE INDEX "empresa_cnpj_key" ON "empresa"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "empresa_comprador_empresaId_pessoaId_key" ON "empresa_comprador"("empresaId", "pessoaId");

-- CreateIndex
CREATE UNIQUE INDEX "participante_pessoaId_key" ON "participante"("pessoaId");

-- CreateIndex
CREATE UNIQUE INDEX "participante_empresaId_key" ON "participante"("empresaId");

-- CreateIndex
CREATE INDEX "consentimento_pessoaId_tipo_criadoEm_idx" ON "consentimento"("pessoaId", "tipo", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "prestador_pessoaId_key" ON "prestador"("pessoaId");

-- CreateIndex
CREATE UNIQUE INDEX "prestador_codigo_key" ON "prestador"("codigo");

-- CreateIndex
CREATE INDEX "prestador_cnpj_idx" ON "prestador"("cnpj");

-- CreateIndex
CREATE INDEX "prestador_status_idx" ON "prestador"("status");

-- CreateIndex
CREATE UNIQUE INDEX "avaliacao_vendaId_key" ON "avaliacao"("vendaId");

-- CreateIndex
CREATE UNIQUE INDEX "carteira_titularChave_tipo_key" ON "carteira"("titularChave", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "lancamento_seq_key" ON "lancamento"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "lancamento_chaveIdempotencia_key" ON "lancamento"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "lancamento_carteiraId_loteId_idx" ON "lancamento"("carteiraId", "loteId");

-- CreateIndex
CREATE INDEX "lancamento_estado_liberaEm_idx" ON "lancamento"("estado", "liberaEm");

-- CreateIndex
CREATE INDEX "lancamento_estado_venceEm_idx" ON "lancamento"("estado", "venceEm");

-- CreateIndex
CREATE INDEX "lancamento_vendaId_idx" ON "lancamento"("vendaId");

-- CreateIndex
CREATE UNIQUE INDEX "reserva_codigo_key" ON "reserva"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "reserva_chaveIdempotencia_key" ON "reserva"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "reserva_carteiraId_status_idx" ON "reserva"("carteiraId", "status");

-- CreateIndex
CREATE INDEX "reserva_status_expiraEm_idx" ON "reserva"("status", "expiraEm");

-- CreateIndex
CREATE INDEX "reserva_alocacao_loteId_idx" ON "reserva_alocacao"("loteId");

-- CreateIndex
CREATE UNIQUE INDEX "loja_codigoErp_key" ON "loja"("codigoErp");

-- CreateIndex
CREATE INDEX "produto_familiaCodigo_idx" ON "produto"("familiaCodigo");

-- CreateIndex
CREATE UNIQUE INDEX "venda_chaveIdempotencia_key" ON "venda"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "venda_compradorPessoaId_idx" ON "venda"("compradorPessoaId");

-- CreateIndex
CREATE INDEX "venda_compradorEmpresaId_idx" ON "venda"("compradorEmpresaId");

-- CreateIndex
CREATE INDEX "venda_prestadorIndicadorId_dataConfirmacao_idx" ON "venda"("prestadorIndicadorId", "dataConfirmacao");

-- CreateIndex
CREATE INDEX "venda_codigoResgate_idx" ON "venda"("codigoResgate");

-- CreateIndex
CREATE UNIQUE INDEX "venda_lojaId_documentoErp_key" ON "venda"("lojaId", "documentoErp");

-- CreateIndex
CREATE UNIQUE INDEX "venda_item_chaveIdempotencia_key" ON "venda_item"("chaveIdempotencia");

-- CreateIndex
CREATE UNIQUE INDEX "venda_item_vendaId_numeroItem_key" ON "venda_item"("vendaId", "numeroItem");

-- CreateIndex
CREATE UNIQUE INDEX "devolucao_chaveIdempotencia_key" ON "devolucao"("chaveIdempotencia");

-- CreateIndex
CREATE UNIQUE INDEX "devolucao_item_chaveIdempotencia_key" ON "devolucao_item"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "vinculo_indicacao_compradorChave_fim_idx" ON "vinculo_indicacao"("compradorChave", "fim");

-- CreateIndex
CREATE UNIQUE INDEX "vinculo_indicacao_compradorChave_prestadorId_inicio_key" ON "vinculo_indicacao"("compradorChave", "prestadorId", "inicio");

-- CreateIndex
CREATE UNIQUE INDEX "indicacao_pre_registro_lojaId_documentoErp_key" ON "indicacao_pre_registro"("lojaId", "documentoErp");

-- CreateIndex
CREATE UNIQUE INDEX "regra_chave_key" ON "regra"("chave");

-- CreateIndex
CREATE UNIQUE INDEX "regra_versao_regraId_versao_key" ON "regra_versao"("regraId", "versao");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_cdc_email_key" ON "usuario_cdc"("email");

-- CreateIndex
CREATE INDEX "auditoria_entidade_entidadeId_idx" ON "auditoria"("entidade", "entidadeId");

-- CreateIndex
CREATE INDEX "auditoria_acao_criadoEm_idx" ON "auditoria"("acao", "criadoEm");

-- CreateIndex
CREATE INDEX "auditoria_usuarioId_criadoEm_idx" ON "auditoria"("usuarioId", "criadoEm");

-- CreateIndex
CREATE INDEX "otp_documento_finalidade_criadoEm_idx" ON "otp"("documento", "finalidade", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "mapeamento_importacao_nome_key" ON "mapeamento_importacao"("nome");

-- CreateIndex
CREATE INDEX "importacao_iniciadaEm_idx" ON "importacao"("iniciadaEm");

-- CreateIndex
CREATE UNIQUE INDEX "divergencia_chave_key" ON "divergencia"("chave");

-- CreateIndex
CREATE INDEX "divergencia_status_criadoEm_idx" ON "divergencia"("status", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "alerta_chave_key" ON "alerta"("chave");

-- CreateIndex
CREATE INDEX "alerta_tipo_status_idx" ON "alerta"("tipo", "status");

-- CreateIndex
CREATE UNIQUE INDEX "notificacao_chave_key" ON "notificacao"("chave");

-- CreateIndex
CREATE INDEX "notificacao_status_agendadaPara_idx" ON "notificacao"("status", "agendadaPara");

-- AddForeignKey
ALTER TABLE "empresa_comprador" ADD CONSTRAINT "empresa_comprador_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "empresa_comprador" ADD CONSTRAINT "empresa_comprador_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "pessoa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participante" ADD CONSTRAINT "participante_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participante" ADD CONSTRAINT "participante_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consentimento" ADD CONSTRAINT "consentimento_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "pessoa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prestador" ADD CONSTRAINT "prestador_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "pessoa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avaliacao" ADD CONSTRAINT "avaliacao_prestadorId_fkey" FOREIGN KEY ("prestadorId") REFERENCES "prestador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avaliacao" ADD CONSTRAINT "avaliacao_vendaId_fkey" FOREIGN KEY ("vendaId") REFERENCES "venda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carteira" ADD CONSTRAINT "carteira_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carteira" ADD CONSTRAINT "carteira_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamento" ADD CONSTRAINT "lancamento_carteiraId_fkey" FOREIGN KEY ("carteiraId") REFERENCES "carteira"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamento" ADD CONSTRAINT "lancamento_vendaId_fkey" FOREIGN KEY ("vendaId") REFERENCES "venda"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamento" ADD CONSTRAINT "lancamento_regraVersaoId_fkey" FOREIGN KEY ("regraVersaoId") REFERENCES "regra_versao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserva" ADD CONSTRAINT "reserva_carteiraId_fkey" FOREIGN KEY ("carteiraId") REFERENCES "carteira"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserva_alocacao" ADD CONSTRAINT "reserva_alocacao_reservaId_fkey" FOREIGN KEY ("reservaId") REFERENCES "reserva"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subfamilia" ADD CONSTRAINT "subfamilia_familiaCodigo_fkey" FOREIGN KEY ("familiaCodigo") REFERENCES "familia"("codigo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venda" ADD CONSTRAINT "venda_prestadorIndicadorId_fkey" FOREIGN KEY ("prestadorIndicadorId") REFERENCES "prestador"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venda_item" ADD CONSTRAINT "venda_item_vendaId_fkey" FOREIGN KEY ("vendaId") REFERENCES "venda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venda_pagamento" ADD CONSTRAINT "venda_pagamento_vendaId_fkey" FOREIGN KEY ("vendaId") REFERENCES "venda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devolucao" ADD CONSTRAINT "devolucao_vendaId_fkey" FOREIGN KEY ("vendaId") REFERENCES "venda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devolucao_item" ADD CONSTRAINT "devolucao_item_devolucaoId_fkey" FOREIGN KEY ("devolucaoId") REFERENCES "devolucao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vinculo_indicacao" ADD CONSTRAINT "vinculo_indicacao_prestadorId_fkey" FOREIGN KEY ("prestadorId") REFERENCES "prestador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regra_versao" ADD CONSTRAINT "regra_versao_regraId_fkey" FOREIGN KEY ("regraId") REFERENCES "regra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otp" ADD CONSTRAINT "otp_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;
