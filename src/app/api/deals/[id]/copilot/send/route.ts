/** POST {text} → envia no WhatsApp do negócio a mensagem sugerida pelo Copiloto (após revisão do vendedor). */
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db";
import { conversations, deals } from "@/db/schema";
import { ApiError, parseBody, route } from "@/lib/api";
import { sendOutbound } from "@/lib/services/messages";
import { logActivity } from "@/lib/activity";

type P = { id: string };
const schema = z.object({ text: z.string().trim().min(1).max(4000) });

export const POST = route<P>(async (req, { auth, params }) => {
  const { text } = await parseBody(req, schema);
  return withTenant(auth.tenantId, async (tx) => {
    const [deal] = await tx.select({ id: deals.id, contactId: deals.contactId }).from(deals).where(and(eq(deals.id, params.id), eq(deals.tenantId, auth.tenantId))).limit(1);
    if (!deal) throw new ApiError(404, "Negócio não encontrado");
    let [conv] = await tx.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.dealId, deal.id), eq(conversations.channel, "WHATSAPP"))).orderBy(desc(conversations.lastMessageAt)).limit(1);
    if (!conv && deal.contactId) {
      [conv] = await tx.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.contactId, deal.contactId), eq(conversations.channel, "WHATSAPP"))).orderBy(desc(conversations.lastMessageAt)).limit(1);
    }
    if (!conv) throw new ApiError(400, "Este negócio não tem conversa de WhatsApp. Copie o texto e envie pelo canal que preferir.");
    const msg = await sendOutbound(tx, { tenantId: auth.tenantId, conversationId: conv.id, senderType: "USER", userId: auth.userId, content: text, type: "TEXT" });
    await logActivity(tx, { tenantId: auth.tenantId, type: "MESSAGE", summary: "Mensagem sugerida pelo Copiloto enviada no WhatsApp", dealId: deal.id, contactId: deal.contactId, userId: auth.userId });
    return msg;
  });
});
