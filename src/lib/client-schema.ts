import { z } from "zod";
const opt = (max = 200) => z.string().trim().max(max).optional().nullable();
export const clientSchema = z.object({
  status: z.enum(["ONBOARDING", "ACTIVE", "PAUSED", "ENDED"]).optional(),
  razaoSocial: z.string().trim().min(2).max(200),
  nomeFantasia: opt(),
  cnpj: z.string().trim().max(20).optional().nullable().transform((v) => (v ? v.replace(/\D/g, "") : v)),
  inscricaoEstadual: opt(40),
  endereco: z.object({ cep: opt(10), logradouro: opt(), numero: opt(20), complemento: opt(), bairro: opt(120), cidade: opt(120), uf: opt(2) }).partial().optional(),
  representante: z
    .object({ nome: opt(160), cpf: opt(20), rg: opt(30), cargo: opt(80), estadoCivil: opt(40), nacionalidade: opt(40), profissao: opt(80), email: opt(160), telefone: opt(30) })
    .partial()
    .optional(),
  emailFinanceiro: z.string().trim().email().optional().nullable().or(z.literal("").transform(() => null)),
  telefone: opt(30),
  servico: opt(2000),
  valor: z.coerce.number().min(0).optional(),
  recorrente: z.boolean().optional(),
  formaPagamento: opt(80),
  diaVencimento: z.coerce.number().int().min(1).max(31).optional().nullable(),
  // "AAAA-MM-DD" vira meio-dia UTC: a data não "volta um dia" no fuso do Brasil
  inicioEm: z.preprocess((v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00Z` : v), z.coerce.date().optional().nullable()),
  vigenciaMeses: z.coerce.number().int().min(1).max(240).optional().nullable(),
  indiceReajuste: opt(40),
  observacoes: opt(4000),
  responsavelId: z.string().uuid().optional().nullable(),
});
