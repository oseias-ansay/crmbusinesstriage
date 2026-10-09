/**
 * Instagram Direct via Meta Graph API (Messenger Platform for Instagram).
 * Requer app Meta com permissão instagram_manage_messages e página vinculada.
 */
export async function sendInstagram(opts: { pageAccessToken: string; recipientId: string; text?: string; imageUrl?: string }) {
  const message = opts.imageUrl
    ? { attachment: { type: "image", payload: { url: opts.imageUrl } } }
    : { text: opts.text ?? "" };
  const res = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${opts.pageAccessToken}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: opts.recipientId }, message }),
  });
  if (!res.ok) throw new Error(`Instagram ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { message_id?: string };
  return { externalId: data.message_id };
}

/** Extrai mensagens recebidas do webhook da Meta (object = "instagram"). */
export function parseInstagramWebhook(payload: any) {
  if (payload?.object !== "instagram") return [];
  const out: { pageId: string; senderId: string; externalId: string; text: string; imageUrl: string | null }[] = [];
  for (const entry of payload.entry ?? []) {
    for (const ev of entry.messaging ?? []) {
      if (!ev.message || ev.message.is_echo) continue;
      out.push({
        pageId: entry.id,
        senderId: ev.sender.id,
        externalId: ev.message.mid,
        text: ev.message.text ?? "",
        imageUrl: ev.message.attachments?.[0]?.payload?.url ?? null,
      });
    }
  }
  return out;
}
