/**
 * Integrações do tenant: API de Conversões da Meta, IA e dados da contratada.
 * GET devolve os segredos mascarados; PATCH só troca um segredo se vier um valor novo.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withAdmin, withTenant } from "@/db";
import { tenants, type TenantSettings } from "@/db/schema";
import { parseBody, route } from "@/lib/api";

const mask = (v?: string) => (v ? `••••${v.slice(-4)}` : "");

const schema = z.object({
  meta: z
    .object({
      enabled: z.boolean().optional(),
      datasetId: z.string().trim().max(40).regex(/^\d*$/, "O ID do conjunto de dados tem só números").optional(),
      accessToken: z.string().trim().max(500).optional(),
      testEventCode: z.string().trim().max(40).optional(),
      onlyAdLeads: z.boolean().optional(),
      wabaId: z.string().trim().max(40).optional(),
    })
    .optional(),
  ai: z
    .object({
      apiKey: z.string().trim().max(300).optional(),
      model: z.string().trim().max(80).optional(),
      dailyLimit: z.coerce.number().int().min(1).max(10000).optional(),
      minConfidence: z.coerce.number().min(0.3).max(1).optional(),
    })
    .optional(),
  company: z
    .object({
      razaoSocial: z.string().max(200).optional(),
      cnpj: z.string().max(20).optional(),
      endereco: z.string().max(300).optional(),
      representante: z.string().max(160).optional(),
      cpfRepresentante: z.string().max(20).optional(),
      cidadeForo: z.string().max(120).optional(),
    })
    .optional(),
});

function view(s: TenantSettings) {
  return {
    meta: { ...s.meta, accessToken: mask(s.meta?.accessToken), hasToken: !!s.meta?.accessToken },
    ai: { ...s.ai, apiKey: mask(s.ai?.apiKey), hasKey: !!s.ai?.apiKey, serverKey: !!process.env.ANTHROPIC_API_KEY },
    company: s.company ?? {},
  };
}

export const GET = route(async (_req, { auth }) =>
  withTenant(auth.tenantId, async (tx) => {
    const [t] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, auth.tenantId));
    return view(t.settings);
  }),
{ minRole: "ADMIN" });

export const PATCH = route(async (req, { auth }) => {
  const body = await parseBody(req, schema);
  const out = await withAdmin(async (tx) => {
    const [t] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, auth.tenantId));
    const s = t.settings;
    // segredo mascarado ("••••1234") ou vazio = mantém o atual
    const keep = (v: string | undefined, cur?: string) => (v === undefined || v.startsWith("••••") ? cur : v || undefined);
    const next: TenantSettings = {
      ...s,
      ...(body.meta && { meta: { ...s.meta, ...body.meta, accessToken: keep(body.meta.accessToken, s.meta?.accessToken) } }),
      ...(body.ai && { ai: { ...s.ai, ...body.ai, apiKey: keep(body.ai.apiKey, s.ai?.apiKey) } }),
      ...(body.company && { company: { ...s.company, ...body.company } }),
    };
    await tx.update(tenants).set({ settings: next }).where(eq(tenants.id, auth.tenantId));
    return next;
  });
  return view(out);
}, { minRole: "ADMIN" });
