/**
 * ════════════════════════════════════════════════════════════════════
 *  API de Conversões da Meta — jornada dos leads de anúncios
 * ════════════════════════════════════════════════════════════════════
 *  Cada marco da jornada (lead, etapa com evento configurado, venda) vira
 *  UMA linha em conversion_events (único por negócio + evento). O worker
 *  envia a fila em lotes, com novas tentativas, e guarda a resposta.
 *
 *  Como o WhatsApp roda pela Evolution (não pela API oficial do WhatsApp),
 *  não existe "WhatsApp Business Account ID"; por isso o envio padrão usa
 *  action_source "chat" e identifica a pessoa por telefone/e-mail
 *  criptografados (SHA-256), como a Meta exige. Se um dia o número migrar
 *  para a API oficial, basta preencher `wabaId` e o envio passa a usar
 *  action_source "business_messaging" + ctwa_clid (atribuição exata ao clique).
 *
 *  LGPD: só envia dados criptografados e só quando o tenant ligou a
 *  integração. A política de privacidade do site precisa informar o
 *  compartilhamento com plataformas de anúncio.
 */
import { createHash } from "node:crypto";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { withAdmin, type Tx } from "@/db";
import { contacts, conversionEvents, deals, tenants, type Attribution, type TenantSettings } from "@/db/schema";

const GRAPH_VERSION = process.env.META_API_VERSION ?? "v23.0";

export { META_EVENTS } from "./events";

const sha = (v: string) => createHash("sha256").update(v.trim().toLowerCase()).digest("hex");

/** Lead "de anúncio" = tem atribuição de Meta (Clique para WhatsApp ou site com fbclid). */
export function isAdLead(a?: Attribution | null) {
  return !!a && (a.channel === "meta_ctwa" || a.channel === "meta_site" || !!a.ctwaClid || !!a.fbclid);
}

/**
 * Enfileira um evento (idempotente). Chamado pelos ganchos da jornada.
 * Não faz nada se a integração estiver desligada ou o lead não for de anúncio
 * (quando onlyAdLeads = true, o padrão).
 */
export async function queueConversion(
  tx: Tx,
  tenantId: string,
  e: { dealId: string; eventName: string; value?: number | null },
) {
  const [row] = await tx
    .select({ settings: tenants.settings, contactId: deals.contactId, value: deals.value, attribution: contacts.attribution })
    .from(deals)
    .innerJoin(tenants, eq(tenants.id, deals.tenantId))
    .leftJoin(contacts, eq(contacts.id, deals.contactId))
    .where(eq(deals.id, e.dealId))
    .limit(1);
  if (!row) return null;
  const meta = row.settings.meta;
  if (!meta?.enabled || !meta.datasetId || !meta.accessToken) return null;
  if ((meta.onlyAdLeads ?? true) && !isAdLead(row.attribution)) return null;

  const value = e.value ?? (e.eventName === "Purchase" ? Number(row.value) : null);
  const [ev] = await tx
    .insert(conversionEvents)
    .values({ tenantId, dealId: e.dealId, contactId: row.contactId, eventName: e.eventName, value: value != null ? String(value) : null })
    .onConflictDoNothing()
    .returning();
  return ev ?? null;
}

type Settings = NonNullable<TenantSettings["meta"]>;

function splitName(n: string) {
  const parts = n.trim().split(/\s+/);
  return { fn: parts[0] ?? "", ln: parts.length > 1 ? parts[parts.length - 1] : "" };
}

/** Monta o evento no formato da Graph API. */
export function buildEvent(
  ev: { id: string; eventName: string; eventTime: Date; value: string | null; dealId: string | null },
  c: { id: string; name: string; phone: string | null; email: string | null; attribution: Attribution } | null,
  s: Settings,
) {
  const a = c?.attribution ?? {};
  const useBM = !!s.wabaId && !!a.ctwaClid;
  // No business_messaging a Meta aceita uma lista própria de nomes.
  const name = useBM && ev.eventName === "Lead" ? "LeadSubmitted" : ev.eventName;

  const user_data: Record<string, unknown> = useBM
    ? { whatsapp_business_account_id: s.wabaId, ctwa_clid: a.ctwaClid }
    : {};
  if (c) {
    if (c.phone) user_data.ph = [sha(c.phone.replace(/\D/g, ""))];
    if (c.email) user_data.em = [sha(c.email)];
    const { fn, ln } = splitName(c.name);
    if (fn && !/^\d+$/.test(fn)) user_data.fn = [sha(fn)];
    if (ln) user_data.ln = [sha(ln)];
    user_data.country = [sha("br")];
    user_data.external_id = [sha(c.id)];
    if (a.fbc) user_data.fbc = a.fbc;
  }

  return {
    event_name: name,
    event_time: Math.floor(ev.eventTime.getTime() / 1000),
    event_id: ev.id, // deduplicação
    action_source: useBM ? "business_messaging" : a.channel === "meta_site" ? "system_generated" : "chat",
    ...(useBM && { messaging_channel: "whatsapp" }),
    user_data,
    custom_data: {
      currency: "BRL",
      ...(ev.value != null && { value: Number(ev.value) }),
      lead_event_source: "Triage CRM",
      ...(a.adId && { ad_id: a.adId }),
      ...(a.headline && { content_name: a.headline }),
      ...(ev.dealId && { order_id: ev.dealId }),
    },
  };
}

/** Envia ao Graph API. Exportado para o botão "Testar conexão". */
export async function postToMeta(s: Settings, data: unknown[]) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(s.datasetId!)}/events`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data, access_token: s.accessToken, ...(s.testEventCode && { test_event_code: s.testEventCode }) }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, body };
}

/** Worker: processa a fila (até `batch` eventos por rodada). */
export async function processConversions(batch = 50) {
  const pending = await withAdmin((tx) =>
    tx
      .select({ ev: conversionEvents, c: contacts, settings: tenants.settings })
      .from(conversionEvents)
      .innerJoin(tenants, eq(tenants.id, conversionEvents.tenantId))
      .leftJoin(contacts, eq(contacts.id, conversionEvents.contactId))
      .where(and(eq(conversionEvents.status, "PENDING"), lt(conversionEvents.attempts, 5)))
      .orderBy(conversionEvents.createdAt)
      .limit(batch),
  );
  if (!pending.length) return 0;

  // Agrupa por tenant (cada um tem seu dataset/token)
  const byTenant = new Map<string, typeof pending>();
  for (const p of pending) byTenant.set(p.ev.tenantId, [...(byTenant.get(p.ev.tenantId) ?? []), p]);

  for (const rows of byTenant.values()) {
    const s = rows[0].settings.meta as Settings | undefined;
    const ids = rows.map((r) => r.ev.id);
    if (!s?.enabled || !s.datasetId || !s.accessToken) {
      await withAdmin((tx) => tx.update(conversionEvents).set({ status: "SKIPPED", response: { motivo: "integração desligada" } }).where(inArray(conversionEvents.id, ids)));
      continue;
    }
    const data = rows.map((r) => buildEvent(r.ev, r.c, s));
    try {
      const out = await postToMeta(s, data);
      await withAdmin(async (tx) => {
        for (let i = 0; i < rows.length; i++) {
          await tx
            .update(conversionEvents)
            .set(
              out.ok
                ? { status: "SENT", sentAt: new Date(), payload: data[i] as Record<string, unknown>, response: out.body, attempts: sql`${conversionEvents.attempts} + 1` }
                : {
                    attempts: sql`${conversionEvents.attempts} + 1`,
                    payload: data[i] as Record<string, unknown>,
                    response: { http: out.status, ...out.body },
                    // erro de parâmetro (4xx) não melhora tentando de novo
                    status: out.status >= 400 && out.status < 500 ? "FAILED" : "PENDING",
                  },
            )
            .where(eq(conversionEvents.id, rows[i].ev.id));
        }
      });
    } catch (e) {
      await withAdmin((tx) =>
        tx
          .update(conversionEvents)
          .set({ attempts: sql`${conversionEvents.attempts} + 1`, response: { erro: String(e) } })
          .where(inArray(conversionEvents.id, ids)),
      );
    }
  }
  // após 5 tentativas sem sucesso, marca como falho
  await withAdmin((tx) =>
    tx.update(conversionEvents).set({ status: "FAILED" }).where(and(eq(conversionEvents.status, "PENDING"), sql`${conversionEvents.attempts} >= 5`)),
  );
  return pending.length;
}
