-- Livro-razão imutável (docs/DECISOES.md · D-005)
-- * DELETE e TRUNCATE proibidos;
-- * valores, carteira, tipo, origem, lote, chave, venda, regra e autoria nunca mudam;
-- * só "estado" (transições válidas), "liberadoEm" e "venceEm" (gravado uma única vez) podem mudar.
-- A limpeza em ambiente de TESTE exige SET cdc.permitir_limpeza = 'on' na sessão.

CREATE OR REPLACE FUNCTION cdc_lancamento_imutavel() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' OR TG_OP = 'DELETE' THEN
    IF coalesce(current_setting('cdc.permitir_limpeza', true), 'off') = 'on' THEN
      RETURN COALESCE(OLD, NEW);
    END IF;
    RAISE EXCEPTION 'livro-razão imutável: % em lancamento não é permitido', TG_OP;
  END IF;

  IF NEW."valorCentavos" IS DISTINCT FROM OLD."valorCentavos"
     OR NEW."carteiraId" IS DISTINCT FROM OLD."carteiraId"
     OR NEW."tipo" IS DISTINCT FROM OLD."tipo"
     OR NEW."origem" IS DISTINCT FROM OLD."origem"
     OR NEW."loteId" IS DISTINCT FROM OLD."loteId"
     OR NEW."chaveIdempotencia" IS DISTINCT FROM OLD."chaveIdempotencia"
     OR NEW."vendaId" IS DISTINCT FROM OLD."vendaId"
     OR NEW."devolucaoId" IS DISTINCT FROM OLD."devolucaoId"
     OR NEW."reservaId" IS DISTINCT FROM OLD."reservaId"
     OR NEW."regraVersaoId" IS DISTINCT FROM OLD."regraVersaoId"
     OR NEW."criadoPor" IS DISTINCT FROM OLD."criadoPor"
     OR NEW."motivo" IS DISTINCT FROM OLD."motivo"
     OR NEW."criadoEm" IS DISTINCT FROM OLD."criadoEm"
     OR NEW."seq" IS DISTINCT FROM OLD."seq"
     OR NEW."liberaEm" IS DISTINCT FROM OLD."liberaEm" THEN
    RAISE EXCEPTION 'livro-razão imutável: apenas estado, liberadoEm e venceEm podem ser atualizados';
  END IF;

  IF OLD."venceEm" IS NOT NULL AND NEW."venceEm" IS DISTINCT FROM OLD."venceEm" THEN
    RAISE EXCEPTION 'livro-razão imutável: venceEm já definido';
  END IF;
  IF OLD."liberadoEm" IS NOT NULL AND NEW."liberadoEm" IS DISTINCT FROM OLD."liberadoEm" THEN
    RAISE EXCEPTION 'livro-razão imutável: liberadoEm já definido';
  END IF;

  IF NEW."estado" IS DISTINCT FROM OLD."estado" AND NOT (
       (OLD."estado" = 'PENDENTE'   AND NEW."estado" IN ('DISPONIVEL', 'ESTORNADO'))
    OR (OLD."estado" = 'DISPONIVEL' AND NEW."estado" IN ('RESGATADO', 'VENCIDO', 'ESTORNADO'))
  ) THEN
    RAISE EXCEPTION 'transição de estado inválida: % -> %', OLD."estado", NEW."estado";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lancamento_imutavel_linha
  BEFORE UPDATE OR DELETE ON "lancamento"
  FOR EACH ROW EXECUTE FUNCTION cdc_lancamento_imutavel();

CREATE TRIGGER lancamento_imutavel_truncate
  BEFORE TRUNCATE ON "lancamento"
  FOR EACH STATEMENT EXECUTE FUNCTION cdc_lancamento_imutavel();

-- Auditoria também é append-only.
CREATE OR REPLACE FUNCTION cdc_append_only() RETURNS trigger AS $$
BEGIN
  IF coalesce(current_setting('cdc.permitir_limpeza', true), 'off') = 'on' THEN
    RETURN COALESCE(OLD, NEW);
  END IF;
  RAISE EXCEPTION 'tabela % é append-only: % não permitido', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auditoria_append_only
  BEFORE UPDATE OR DELETE ON "auditoria"
  FOR EACH ROW EXECUTE FUNCTION cdc_append_only();
CREATE TRIGGER auditoria_append_only_truncate
  BEFORE TRUNCATE ON "auditoria"
  FOR EACH STATEMENT EXECUTE FUNCTION cdc_append_only();

CREATE TRIGGER regra_versao_append_only
  BEFORE UPDATE OR DELETE ON "regra_versao"
  FOR EACH ROW EXECUTE FUNCTION cdc_append_only();

CREATE TRIGGER consentimento_append_only
  BEFORE UPDATE OR DELETE ON "consentimento"
  FOR EACH ROW EXECUTE FUNCTION cdc_append_only();

-- Valor de lançamento nunca é zero; lote (crédito) sempre positivo.
ALTER TABLE "lancamento" ADD CONSTRAINT lancamento_valor_nao_zero CHECK ("valorCentavos" <> 0);
ALTER TABLE "lancamento" ADD CONSTRAINT lancamento_credito_positivo CHECK ("tipo" <> 'CREDITO' OR "valorCentavos" > 0);
ALTER TABLE "reserva" ADD CONSTRAINT reserva_valor_positivo CHECK ("valorCentavos" > 0);
ALTER TABLE "reserva_alocacao" ADD CONSTRAINT reserva_alocacao_positiva CHECK ("valorCentavos" > 0);
