/**
 * Captura pública de leads (formulário do site, landing pages, Meta Lead Ads via n8n).
 * POST /api/forms/<slug-do-tenant>
 *   { formId?: "site-contato", name, email?, phone?, company?, message?, utm_source?, ...extras }
 * Reaproveita o contato se o e-mail ou o telefone já existir (ex.: quem já falou no WhatsApp),
 * cria o negócio no funil padrão e dispara FORM_SUBMITTED e DEAL_CREATED.
 * Proteções: honeypot ("website" preenchido = robô, responde ok sem gravar) e limite por IP.
 */
import { NextResponse } from "next/server";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { withAdmin, withTenant } from "@/db";
import { contactTags, contacts, dealTags, tenants, type Attribution } from "@/db/schema";
import { ensureTags } from "@/lib/services/deals";
import { queueConversion } from "@/lib/meta/capi";
import { mergeAttribution } from "@/lib/services/messages";
import { createDeal, defaultPipelineFirstStage } from "@/lib/services/deals";
import { fireTrigger } from "@/lib/automation/engine";
import { emitToTenant } from "@/lib/realtime";
import { handleError, ApiError } from "@/lib/api";
import { normalizePhone } from "@/lib/utils";
import { logActivity } from "@/lib/activity";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const schema = z
  .object({
    formId: z.string().max(60).default("default"),
    name: z.string().min(2).max(160),
    email: z.string().email().optional().or(z.literal("")),
    phone: z.string().max(30).optional(),
    company: z.string().max(160).optional(),
    message: z.string().max(4000).optional(),
    utm_source: z.string().max(80).optional(),
    website: z.string().max(0).optional(), // honeypot anti-spam: deve vir vazio
  })
  .passthrough();

/** Limite simples em memória: 5 envios por IP a cada 10 minutos. */
const hits = new Map<string, number[]>();
function rateLimited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > 5;
}

/** Celular BR com e sem o 9º dígito (o WhatsApp às vezes grava sem). */
function phoneVariants(p: string | null): string[] {
  if (!p) return [];
  const v = new Set([p]);
  const m = p.match(/^55(\d{2})(\d{8,9})$/);
  if (m) {
    const [, ddd, num] = m;
    if (num.length === 9 && num.startsWith("9")) v.add(`55${ddd}${num.slice(1)}`);
    if (num.length === 8) v.add(`55${ddd}9${num}`);
  }
  return [...v];
}

/**
 * Adaptador para o payload dos diagnósticos do site Business Triage
 * ({ meta: { formulario }, identificacao: {...}, comercial|financeiro: {...}, protocolo? }).
 * Converte para o formato plano do formulário; as respostas viram uma nota legível.
 */
function fromDiagnostico(raw: Record<string, unknown>) {
  const meta = (raw.meta ?? {}) as Record<string, unknown>;
  const id = (raw.identificacao ?? {}) as Record<string, unknown>;
  const respostas = Object.entries(raw).filter(([k, v]) => !["meta", "identificacao", "protocolo"].includes(k) && v && typeof v === "object");
  const linhas = respostas.flatMap(([grupo, obj]) => [
    `— ${grupo} —`,
    ...Object.entries(obj as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== "" && !(Array.isArray(v) && !v.length))
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v)}`),
  ]);
  const formId = String(meta.formulario ?? "diagnostico");
  return {
    formId,
    name: String(id.razao_social || id.nome || id.email || "Lead do site"),
    email: id.email ? String(id.email) : undefined,
    phone: id.telefone ? String(id.telefone) : undefined,
    company: id.razao_social ? String(id.razao_social) : undefined,
    message: `${formId}${raw.protocolo ? ` · protocolo ${raw.protocolo}` : ""}\n${linhas.join("\n")}`.slice(0, 4000),
    utm_source: typeof meta.utm_source === "string" ? meta.utm_source : undefined,
    ...(id.cnpj ? { cnpj: String(id.cnpj) } : {}),
    ...(id.setor ? { setor: String(id.setor) } : {}),
    ...(raw.protocolo ? { [`protocolo_${formId.replace(/-/g, "_")}`]: String(raw.protocolo) } : {}),
    ...(meta.pagina ? { pagina: String(meta.pagina) } : {}),
  };
}

export async function OPTIONS() {
  return new Response(null, { headers: cors });
}

export async function POST(req: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
  try {
    const { tenantSlug } = await params;
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "?";
    if (rateLimited(ip)) throw new ApiError(429, "Muitos envios. Tente novamente em alguns minutos.");
    const raw = await req.json();
    if (raw && typeof raw === "object" && raw.website) return NextResponse.json({ ok: true }, { headers: cors }); // robô
    const isDiag = raw && typeof raw === "object" && raw.identificacao && raw.meta;
    const body = schema.parse(isDiag ? fromDiagnostico(raw) : raw);
    const [tenant] = await withAdmin((tx) => tx.select().from(tenants).where(eq(tenants.slug, tenantSlug)).limit(1));
    if (!tenant || tenant.status === "SUSPENDED") throw new ApiError(404, "Formulário indisponível");

    const { formId, name, email, phone, company, message, utm_source, website: _hp, ...extras } = body; // eslint-disable-line @typescript-eslint/no-unused-vars
    const result = await withTenant(tenant.id, async (tx) => {
      const phoneN = normalizePhone(phone);
      // Veio de anúncio da Meta? (fbclid do clique ou UTM facebook/instagram)
      const ex = extras as Record<string, unknown>;
      const fbclid = typeof ex.fbclid === "string" ? ex.fbclid : undefined;
      const fromMeta = !!fbclid || /facebook|instagram|meta|fb|ig/i.test(String(utm_source ?? ""));
      const now = new Date().toISOString();
      const attribution: Attribution | null = fromMeta
        ? {
            channel: "meta_site",
            fbclid,
            fbc: fbclid ? `fb.1.${Date.now()}.${fbclid}` : undefined,
            adId: typeof ex.utm_content === "string" ? ex.utm_content : undefined,
            headline: typeof ex.utm_campaign === "string" ? ex.utm_campaign : undefined,
            sourceUrl: typeof ex.pagina === "string" ? ex.pagina : undefined,
            utm: Object.fromEntries(Object.entries({ utm_source, ...ex }).filter(([k, v]) => k.startsWith("utm_") && typeof v === "string")) as Record<string, string>,
            firstAt: now,
            lastAt: now,
          }
        : null;
      const fields = { ...extras, ...(company && { empresa: company }), ...(isDiag && { qualificacao: "Qualificado (diagnóstico do site)" }) };
      const conds = [
        email ? sql`lower(${contacts.email}) = ${email.toLowerCase()}` : undefined,
        phoneN ? inArray(contacts.phone, phoneVariants(phoneN)) : undefined,
      ].filter(Boolean);
      const [existing] = conds.length
        ? await tx.select().from(contacts).where(and(eq(contacts.tenantId, tenant.id), or(...(conds as never[])))).limit(1)
        : [];
      let contact;
      if (existing) {
        // Completa o que faltava sem sobrescrever o que já existe (ex.: nome vindo do WhatsApp).
        [contact] = await tx
          .update(contacts)
          .set({
            email: existing.email ?? (email || null),
            phone: existing.phone ?? phoneN,
            name: /^\+?\d+$/.test(existing.name) ? name : existing.name,
            customFields: { ...(existing.customFields as Record<string, unknown>), ...fields },
            ...(attribution && { attribution: mergeAttribution(existing.attribution, attribution) }),
            updatedAt: new Date(),
          })
          .where(eq(contacts.id, existing.id))
          .returning();
      } else {
        [contact] = await tx
          .insert(contacts)
          .values({ tenantId: tenant.id, name, email: email || null, phone: phoneN, source: utm_source ?? `form:${formId}`, customFields: fields, attribution: attribution ?? {} })
          .returning();
      }
      const target = await defaultPipelineFirstStage(tx, tenant.id);
      if (!target) throw new ApiError(500, "Tenant sem pipeline");
      const deal = await createDeal(tx, tenant.id, null, { title: `${company ?? name} — ${formId}`, pipelineId: target.pipelineId, stageId: target.stageId, contactId: contact.id, source: utm_source ?? `form:${formId}` });
      if (isDiag) {
        const t = await ensureTags(tx, tenant.id, ["Qualificado"]);
        await tx.insert(contactTags).values({ tenantId: tenant.id, contactId: contact.id, tagId: t[0].id }).onConflictDoNothing();
        await tx.insert(dealTags).values({ tenantId: tenant.id, dealId: deal.id, tagId: t[0].id }).onConflictDoNothing();
        await queueConversion(tx, tenant.id, { dealId: deal.id, eventName: "QualifiedLead" });
      }
      if (message) await logActivity(tx, { tenantId: tenant.id, type: "NOTE", summary: `Mensagem do formulário: ${message}`, dealId: deal.id, contactId: contact.id });
      return { contact, deal };
    });

    emitToTenant(tenant.id, "deal:created", result.deal);
    fireTrigger(tenant.id, "FORM_SUBMITTED", { formId, dealId: result.deal.id, contactId: result.contact.id });
    fireTrigger(tenant.id, "DEAL_CREATED", { dealId: result.deal.id, contactId: result.contact.id, pipelineId: result.deal.pipelineId, stageId: result.deal.stageId });
    return NextResponse.json({ ok: true }, { headers: cors });
  } catch (e) {
    const res = handleError(e);
    Object.entries(cors).forEach(([k, v]) => res.headers.set(k, v));
    return res;
  }
}
