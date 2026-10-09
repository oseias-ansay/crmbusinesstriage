/**
 * ════════════════════════════════════════════════════════════════════
 *  Google Agenda — OAuth da conta da empresa + eventos dos agendamentos
 * ════════════════════════════════════════════════════════════════════
 *  - O tenant cria um "OAuth client" no Google Cloud (Client ID + Secret),
 *    clica em "Conectar Google Agenda" e autoriza com a conta da empresa.
 *  - Guardamos só o refresh_token (escopos: eventos + free/busy).
 *  - Horários oferecidos pelo robô descontam o que está ocupado no calendário.
 *  - Agendou → evento com link do Google Meet (e convite ao lead, se tiver e-mail).
 *  Falha no Google NUNCA desfaz o agendamento no CRM: só fica registrada no log.
 */
import { eq } from "drizzle-orm";
import { withAdmin } from "@/db";
import { tenants, type TenantSettings } from "@/db/schema";

const OAUTH = process.env.GOOGLE_OAUTH_BASE ?? "https://oauth2.googleapis.com";
const AUTH = process.env.GOOGLE_AUTH_BASE ?? "https://accounts.google.com";
const API = process.env.GOOGLE_API_BASE ?? "https://www.googleapis.com";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "openid",
  "email",
];

type G = NonNullable<TenantSettings["google"]>;

export function authUrl(g: G, redirectUri: string, state: string) {
  const p = new URLSearchParams({
    client_id: g.clientId!,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent", // garante refresh_token
    include_granted_scopes: "true",
    scope: GOOGLE_SCOPES.join(" "),
    state,
  });
  return `${AUTH}/o/oauth2/v2/auth?${p}`;
}

export async function exchangeCode(g: G, code: string, redirectUri: string) {
  const res = await fetch(`${OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: g.clientId!, client_secret: g.clientSecret!, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await res.json()) as { access_token?: string; refresh_token?: string; id_token?: string; error_description?: string; error?: string };
  if (!res.ok || !j.access_token) throw new Error(j.error_description ?? j.error ?? `Google ${res.status}`);
  let email: string | undefined;
  if (j.id_token) {
    try {
      email = JSON.parse(Buffer.from(j.id_token.split(".")[1], "base64url").toString()).email;
    } catch {}
  }
  return { accessToken: j.access_token, refreshToken: j.refresh_token, email };
}

// cache curto do access token por tenant
const cache = new Map<string, { token: string; exp: number }>();

async function accessToken(tenantId: string, g: G) {
  const c = cache.get(tenantId);
  if (c && c.exp > Date.now() + 60_000) return c.token;
  const res = await fetch(`${OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: g.clientId!, client_secret: g.clientSecret!, refresh_token: g.refreshToken!, grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await res.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !j.access_token) {
    // token revogado/expirado: marca como desconectado para a tela avisar
    if (j.error === "invalid_grant") await setGoogle(tenantId, { refreshToken: undefined });
    throw new Error(`Google: ${j.error_description ?? j.error ?? res.status}`);
  }
  cache.set(tenantId, { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 });
  return j.access_token;
}

export async function getGoogle(tenantId: string): Promise<G | null> {
  const [t] = await withAdmin((tx) => tx.select({ s: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1));
  const g = t?.s.google;
  return g?.clientId && g.clientSecret && g.refreshToken ? g : null;
}

export async function setGoogle(tenantId: string, patch: Partial<G>) {
  cache.delete(tenantId);
  await withAdmin(async (tx) => {
    const [t] = await tx.select({ s: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    const google = { ...t.s.google, ...patch };
    for (const k of Object.keys(google) as (keyof G)[]) if (google[k] === undefined) delete google[k];
    await tx.update(tenants).set({ settings: { ...t.s, google } }).where(eq(tenants.id, tenantId));
  });
}

async function call<T>(tenantId: string, g: G, path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken(tenantId, g);
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 204) return undefined as T;
  const j = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Google ${res.status}: ${j.error?.message ?? "erro"}`);
  return j;
}

const cal = (g: G) => encodeURIComponent(g.calendarId || "primary");

export async function listCalendars(tenantId: string, g: G) {
  const j = await call<{ items?: { id: string; summary: string; primary?: boolean; accessRole: string }[] }>(tenantId, g, "/calendar/v3/users/me/calendarList?minAccessRole=writer");
  return (j.items ?? []).map((c) => ({ id: c.id, name: c.summary, primary: !!c.primary }));
}

/** Intervalos ocupados no calendário entre `from` e `to`. */
export async function busyIntervals(tenantId: string, from: Date, to: Date): Promise<{ start: Date; end: Date }[]> {
  const g = await getGoogle(tenantId);
  if (!g) return [];
  try {
    const j = await call<{ calendars?: Record<string, { busy?: { start: string; end: string }[] }> }>(tenantId, g, "/calendar/v3/freeBusy", {
      method: "POST",
      body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: g.calendarId || "primary" }] }),
    });
    return Object.values(j.calendars ?? {}).flatMap((c) => (c.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) })));
  } catch (e) {
    console.error("[google] freeBusy", e);
    return []; // sem Google, segue só com a agenda do CRM
  }
}

/** Cria o evento do agendamento. Devolve id e link do Meet (ou null se o Google não estiver conectado/falhar). */
export async function createEvent(
  tenantId: string,
  ev: { summary: string; description: string; start: Date; durationMin: number; attendeeEmail?: string | null; requestId: string },
): Promise<{ id: string; meetLink: string | null; htmlLink?: string } | null> {
  const g = await getGoogle(tenantId);
  if (!g) return null;
  try {
    const withMeet = g.createMeet !== false;
    const invite = g.inviteContact !== false && !!ev.attendeeEmail;
    const body = {
      summary: ev.summary,
      description: ev.description,
      start: { dateTime: ev.start.toISOString(), timeZone: "America/Sao_Paulo" },
      end: { dateTime: new Date(ev.start.getTime() + ev.durationMin * 60_000).toISOString(), timeZone: "America/Sao_Paulo" },
      ...(invite && { attendees: [{ email: ev.attendeeEmail }] }),
      ...(withMeet && { conferenceData: { createRequest: { requestId: ev.requestId, conferenceSolutionKey: { type: "hangoutsMeet" } } } }),
      reminders: { useDefault: true },
    };
    const q = new URLSearchParams({ conferenceDataVersion: withMeet ? "1" : "0", sendUpdates: invite ? "all" : "none" });
    const j = await call<{ id: string; hangoutLink?: string; htmlLink?: string; conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[] } }>(
      tenantId,
      g,
      `/calendar/v3/calendars/${cal(g)}/events?${q}`,
      { method: "POST", body: JSON.stringify(body) },
    );
    const meet = j.hangoutLink ?? j.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ?? null;
    return { id: j.id, meetLink: meet, htmlLink: j.htmlLink };
  } catch (e) {
    console.error("[google] createEvent", e);
    return null;
  }
}

export async function deleteEvent(tenantId: string, eventId: string) {
  const g = await getGoogle(tenantId);
  if (!g) return;
  try {
    await call(tenantId, g, `/calendar/v3/calendars/${cal(g)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`, { method: "DELETE" });
  } catch (e) {
    console.error("[google] deleteEvent", e);
  }
}

export async function patchEventTime(tenantId: string, eventId: string, start: Date, durationMin: number) {
  const g = await getGoogle(tenantId);
  if (!g) return;
  try {
    await call(tenantId, g, `/calendar/v3/calendars/${cal(g)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`, {
      method: "PATCH",
      body: JSON.stringify({
        start: { dateTime: start.toISOString(), timeZone: "America/Sao_Paulo" },
        end: { dateTime: new Date(start.getTime() + durationMin * 60_000).toISOString(), timeZone: "America/Sao_Paulo" },
      }),
    });
  } catch (e) {
    console.error("[google] patchEvent", e);
  }
}
