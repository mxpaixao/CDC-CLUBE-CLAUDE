import { z } from 'zod';
import {
  cnpjValido,
  cpfValido,
  normalizarCnpj,
  normalizarCpf,
  normalizarTelefone,
} from './documentos';

export const cpfSchema = z
  .string()
  .transform((v) => normalizarCpf(v))
  .refine(cpfValido, { message: 'CPF inválido' });

export const cnpjSchema = z
  .string()
  .transform((v) => normalizarCnpj(v))
  .refine(cnpjValido, { message: 'CNPJ inválido' });

export const telefoneSchema = z.string().transform((v, ctx) => {
  const t = normalizarTelefone(v);
  if (!t) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Telefone inválido (use DDD + número)' });
    return z.NEVER;
  }
  return t;
});

export const centavosSchema = z.number().int().min(0);
export const centavosComSinalSchema = z.number().int();

export const TIPOS_CONSENTIMENTO = [
  'ADESAO_PROGRAMA',
  'MARKETING_WHATSAPP',
  'MARKETING_SMS',
  'MARKETING_EMAIL',
  'MARKETING_PUSH',
  'PERFIL_PUBLICO',
] as const;
export type TipoConsentimento = (typeof TIPOS_CONSENTIMENTO)[number];

export const PERMISSOES = [
  'cadastro',
  'operacao_caixa',
  'alteracao_regras',
  'ajuste_saldo',
  'aprovacao_prestador',
  'visualizacao_relatorios',
  'admin',
] as const;
export type Permissao = (typeof PERMISSOES)[number];

export const ESPECIALIDADES_PADRAO = [
  'eletricista',
  'encanador',
  'pintor',
  'refrigeracao',
  'serralheiro',
  'pedreiro',
  'marceneiro',
  'gesseiro',
  'vidraceiro',
  'mecanico_industrial',
] as const;
