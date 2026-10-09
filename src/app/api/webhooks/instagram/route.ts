/**
 * Webhook da Meta para Instagram Direct.
 * GET = verificação do webhook (hub.challenge) · POST = mensagens recebidas.
 * O tenant é descoberto pelo id da página/conta (channel_connections.externalId).
 */
import { NextResponse } from "next/server";
import { parseInstagramWebhook } from "@/lib/channels/instagram";
import { handleInbound, resolveConnection } from "@/lib/services/messages";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  if (sp.get("hub.mode") === "subscribe" && sp.get("hub.verify_token") === process.env.META_VERIFY_TOKEN) {
    return new Response(sp.get("hub.challenge") ?? "");
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const payload = await req.json().catch(() => null);
  // TODO produção: validar assinatura X-Hub-Signature-256 com o App Secret
  for (const m of parseInstagramWebhook(payload)) {
    const conn = await resolveConnection("INSTAGRAM", m.pageId);
    if (!conn) continue;
    await handleInbound({
      tenantId: conn.tenantId,
      channel: "INSTAGRAM",
      connectionId: conn.id,
      externalId: m.externalId,
      instagramId: m.senderId,
      name: `Instagram ${m.senderId.slice(-4)}`,
      type: m.imageUrl ? "IMAGE" : "TEXT",
      content: m.text,
      mediaUrl: m.imageUrl,
    });
  }
  return NextResponse.json({ ok: true });
}
