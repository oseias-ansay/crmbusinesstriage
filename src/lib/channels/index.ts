/**
 * Roteador de envio: dado uma conversa, envia pelo canal certo.
 * Usado pelo Inbox, pelas automações e pelo bot de triagem.
 */
import { eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { channelConnections, contacts, conversations, tenants } from "@/db/schema";
import { sendWhatsApp } from "./whatsapp";
import { sendInstagram } from "./instagram";
import { sendEmail } from "./email";

export type OutboundPayload = {
  text: string;
  type?: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT";
  mediaUrl?: string | null;
  mediaMime?: string | null;
  subject?: string;
};

export async function deliverToChannel(tx: Tx, conversationId: string, p: OutboundPayload): Promise<{ externalId?: string }> {
  const [row] = await tx
    .select({ conv: conversations, contact: contacts, conn: channelConnections, tenant: tenants })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .innerJoin(tenants, eq(tenants.id, conversations.tenantId))
    .leftJoin(channelConnections, eq(channelConnections.id, conversations.connectionId))
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!row) throw new Error("Conversa não encontrada");

  const abs = (u?: string | null) => (u && u.startsWith("/") ? `${process.env.PUBLIC_URL ?? ""}${u}` : u ?? undefined);

  switch (row.conv.channel) {
    case "WHATSAPP": {
      if (!row.contact.phone) throw new Error("Contato sem telefone");
      return sendWhatsApp({
        instance: row.conn?.externalId ?? "default",
        to: row.contact.phone,
        text: p.text,
        media: p.mediaUrl && p.type && p.type !== "TEXT" ? { url: abs(p.mediaUrl)!, mime: p.mediaMime ?? undefined, type: p.type } : undefined,
        settings: row.tenant.settings,
      });
    }
    case "INSTAGRAM": {
      const token = row.conn?.config?.pageAccessToken;
      const igId = (row.contact.customFields as Record<string, string>)?.instagram_id;
      if (!token || !igId) throw new Error("Instagram não configurado para este contato");
      return sendInstagram({ pageAccessToken: token, recipientId: igId, text: p.text, imageUrl: p.type === "IMAGE" ? abs(p.mediaUrl) : undefined });
    }
    case "EMAIL": {
      if (!row.contact.email) throw new Error("Contato sem e-mail");
      return sendEmail({ to: row.contact.email, subject: p.subject ?? `Mensagem de ${row.tenant.name}`, html: p.text.replace(/\n/g, "<br>"), settings: row.tenant.settings });
    }
    default:
      return {}; // INTERNAL / WEBCHAT: entrega só via socket
  }
}
