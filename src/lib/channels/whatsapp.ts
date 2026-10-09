/**
 * WhatsApp via Evolution API (self-hosted, comum no mercado BR).
 * Docs: https://doc.evolution-api.com
 *
 * Cada tenant conecta uma ou mais instâncias (channel_connections.externalId
 * = nome da instância). Credenciais vêm de tenants.settings.evolution ou do .env.
 *
 * Para usar a API oficial (WhatsApp Cloud API / Meta), implemente a mesma
 * interface `sendWhatsApp` chamando graph.facebook.com/{phone-id}/messages.
 */
import type { Attribution, TenantSettings } from "@/db/schema";

type SendInput = {
  instance: string;
  to: string; // dígitos com DDI
  text?: string;
  media?: { url: string; mime?: string; type: "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT"; fileName?: string; caption?: string };
  settings?: TenantSettings;
};

export async function sendWhatsApp({ instance, to, text, media, settings }: SendInput): Promise<{ externalId?: string }> {
  const baseUrl = settings?.evolution?.baseUrl ?? process.env.EVOLUTION_API_URL;
  const apiKey = settings?.evolution?.apiKey ?? process.env.EVOLUTION_API_KEY;
  if (!baseUrl || !apiKey) {
    console.warn("[whatsapp] Evolution API não configurada — mensagem não enviada (modo simulação)");
    return {};
  }

  const headers = { "Content-Type": "application/json", apikey: apiKey };
  let url: string;
  let body: Record<string, unknown>;

  if (media?.type === "AUDIO") {
    url = `${baseUrl}/message/sendWhatsAppAudio/${instance}`;
    body = { number: to, audio: media.url };
  } else if (media) {
    url = `${baseUrl}/message/sendMedia/${instance}`;
    body = {
      number: to,
      mediatype: media.type.toLowerCase(),
      mimetype: media.mime,
      media: media.url,
      fileName: media.fileName,
      caption: media.caption ?? text,
    };
  } else {
    url = `${baseUrl}/message/sendText/${instance}`;
    body = { number: to, text };
  }

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Evolution API ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { key?: { id?: string } };
  return { externalId: data.key?.id };
}

/**
 * Anúncio "Clique para WhatsApp": a primeira mensagem chega com
 * contextInfo.externalAdReply (id do anúncio, título, link e ctwaClid).
 * A Evolution coloca o contextInfo em lugares diferentes conforme o tipo de
 * mensagem/versão, então procuramos em toda a árvore (com limite de profundidade).
 */
export function extractAdReferral(d: any): Attribution | null {
  let found: any = null;
  let ctx: any = null;
  const walk = (o: any, depth: number) => {
    if (found || !o || typeof o !== "object" || depth > 6) return;
    if (o.externalAdReply && typeof o.externalAdReply === "object") {
      found = o.externalAdReply;
      ctx = o;
      return;
    }
    for (const v of Object.values(o)) walk(v, depth + 1);
  };
  walk(d, 0);
  if (!found) return null;
  const isAd = found.sourceType === "ad" || !!found.ctwaClid || !!found.sourceId || /FB_Ads|ctwa/i.test(String(ctx?.conversionSource ?? ctx?.entryPointConversionSource ?? ""));
  if (!isAd) return null;
  const now = new Date().toISOString();
  return {
    channel: "meta_ctwa",
    adId: found.sourceId ? String(found.sourceId) : undefined,
    ctwaClid: found.ctwaClid ? String(found.ctwaClid) : undefined,
    sourceUrl: found.sourceUrl ? String(found.sourceUrl) : undefined,
    headline: found.title ? String(found.title).slice(0, 200) : undefined,
    body: found.body ? String(found.body).slice(0, 500) : undefined,
    mediaType: found.mediaType != null ? String(found.mediaType) : undefined,
    firstAt: now,
    lastAt: now,
  };
}

/**
 * Normaliza o payload do webhook "messages.upsert" da Evolution API.
 * fromMe = mensagem que SAIU do número (n8n, celular ou o próprio CRM) — usada
 * para espelhar a conversa completa no Inbox quando o número é compartilhado.
 */
export function parseEvolutionWebhook(payload: any) {
  if (payload?.event !== "messages.upsert") return null;
  const d = payload.data;
  if (!d?.key) return null;
  const fromMe = !!d.key.fromMe;
  const jid: string = d.key.remoteJid ?? "";
  if (jid.endsWith("@g.us")) return null; // ignora grupos
  const m = d.message ?? {};
  const type = m.imageMessage ? "IMAGE" : m.audioMessage ? "AUDIO" : m.videoMessage ? "VIDEO" : m.documentMessage ? "DOCUMENT" : "TEXT";
  const content: string =
    m.conversation ?? m.extendedTextMessage?.text ?? m.imageMessage?.caption ?? m.videoMessage?.caption ?? m.documentMessage?.fileName ?? "";
  return {
    instance: payload.instance as string,
    externalId: d.key.id as string,
    phone: jid.split("@")[0],
    // em mensagens enviadas, pushName é o nome da própria empresa → usa o telefone
    name: (!fromMe && (d.pushName as string)) || jid.split("@")[0],
    fromMe,
    type: type as "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT",
    content,
    mediaUrl: (d.mediaUrl as string | undefined) ?? null, // habilite "webhook_base64"/S3 na Evolution para mídia
    attribution: fromMe ? null : extractAdReferral(d),
  };
}
