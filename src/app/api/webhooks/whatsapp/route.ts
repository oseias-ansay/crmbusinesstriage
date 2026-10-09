/**
 * Webhook da Evolution API (evento messages.upsert).
 * Pode ser chamado direto pela Evolution OU repassado pelo n8n (mesmo payload),
 * quando o número já é atendido por um fluxo do n8n.
 * URL = https://<seu-crm>/api/webhooks/whatsapp?token=<webhookToken>
 * O tenant é descoberto pela instância (channel_connections.externalId).
 */
import { NextResponse } from "next/server";
import { parseEvolutionWebhook } from "@/lib/channels/whatsapp";
import { handleInbound, resolveConnection } from "@/lib/services/messages";

export async function POST(req: Request) {
  const payload = await req.json().catch(() => null);
  const msg = parseEvolutionWebhook(payload);
  if (!msg) return NextResponse.json({ ignored: true });

  const conn = await resolveConnection("WHATSAPP", msg.instance);
  if (!conn) return NextResponse.json({ error: "Instância não vinculada" }, { status: 404 });

  const token = new URL(req.url).searchParams.get("token");
  if (conn.config.webhookToken && conn.config.webhookToken !== token) {
    return NextResponse.json({ error: "Token inválido" }, { status: 401 });
  }

  await handleInbound({
    tenantId: conn.tenantId,
    channel: "WHATSAPP",
    connectionId: conn.id,
    externalId: msg.externalId,
    phone: msg.phone,
    name: msg.name,
    type: msg.type,
    content: msg.content,
    mediaUrl: msg.mediaUrl,
    fromMe: msg.fromMe,
    attribution: msg.attribution,
  });
  return NextResponse.json({ ok: true });
}
