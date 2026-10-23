/**
 * Conversas do card.
 * GET  → conversas do contato do negócio (as deste negócio primeiro) + números de WhatsApp disponíveis
 * POST {connectionId?} → inicia uma conversa de WhatsApp com o contato, já vinculada ao negócio
 *
 * Mesma regra de visibilidade do Inbox: o AGENTE vê as conversas dele e as da fila —
 * e também as do negócio do qual ele é o responsável.
 */
import { and, desc, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type Tx } from "@/db";
import { channelConnections, contacts, conversations, deals, users } from "@/db/schema";
import { ApiError, parseBody, route } from "@/lib/api";
import { emitToTenant } from "@/lib/realtime";

type P = { id: string };

async function loadDeal(tx: Tx, tenantId: string, id: string) {
  const [d] = await tx
    .select({ id: deals.id, contactId: deals.contactId, pipelineId: deals.pipelineId, userId: deals.userId, phone: contacts.phone })
    .from(deals)
    .leftJoin(contacts, eq(contacts.id, deals.contactId))
    .where(and(eq(deals.id, id), eq(deals.tenantId, tenantId)))
    .limit(1);
  if (!d) throw new ApiError(404, "Negócio não encontrado");
  return d;
}

export const GET = route<P>(async (_req, { auth, params }) =>
  withTenant(auth.tenantId, async (tx) => {
    const d = await loadDeal(tx, auth.tenantId, params.id);
    const conns = await tx
      .select({ id: channelConnections.id, name: channelConnections.name, routing: channelConnections.routing })
      .from(channelConnections)
      .where(and(eq(channelConnections.channel, "WHATSAPP"), eq(channelConnections.isActive, true)));
    const numbers = conns
      .map((c) => ({ id: c.id, name: c.name, suggested: c.routing?.pipelineId === d.pipelineId || !!c.routing?.rules?.some((r) => r.pipelineId === d.pipelineId) }))
      .sort((a, b) => Number(b.suggested) - Number(a.suggested));
    if (!d.contactId) return { me: auth.userId, conversations: [], numbers, hasPhone: false };

    const f: SQL[] = [eq(conversations.contactId, d.contactId)];
    if (auth.role === "AGENT" && d.userId !== auth.userId) f.push(or(eq(conversations.assignedToId, auth.userId), isNull(conversations.assignedToId))!);
    const rows = await tx
      .select({
        id: conversations.id,
        channel: conversations.channel,
        status: conversations.status,
        unreadCount: conversations.unreadCount,
        lastMessageAt: conversations.lastMessageAt,
        lastMessagePreview: conversations.lastMessagePreview,
        assignedToId: conversations.assignedToId,
        assignedToName: users.name,
        dealId: conversations.dealId,
        dealTitle: deals.title,
        connectionId: conversations.connectionId,
        connectionName: channelConnections.name,
        contact: { id: contacts.id, name: contacts.name, phone: contacts.phone, email: contacts.email },
      })
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .leftJoin(users, eq(users.id, conversations.assignedToId))
      .leftJoin(deals, eq(deals.id, conversations.dealId))
      .leftJoin(channelConnections, eq(channelConnections.id, conversations.connectionId))
      .where(and(...f))
      .orderBy(sql`(${conversations.dealId} = ${d.id}) desc nulls last`, desc(conversations.lastMessageAt))
      .limit(20);
    return { me: auth.userId, conversations: rows, numbers, hasPhone: !!d.phone };
  }),
);

const schema = z.object({ connectionId: z.string().uuid().nullish() });

export const POST = route<P>(async (req, { auth, params }) => {
  const body = await parseBody(req, schema);
  const conv = await withTenant(auth.tenantId, async (tx) => {
    const d = await loadDeal(tx, auth.tenantId, params.id);
    if (!d.contactId) throw new ApiError(400, "Vincule um contato ao negócio antes de iniciar a conversa.");
    if (!d.phone) throw new ApiError(400, "O contato não tem telefone. Cadastre o WhatsApp dele no contato.");
    const connectionId = body.connectionId ?? null;
    const [existing] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.contactId, d.contactId), eq(conversations.channel, "WHATSAPP"), connectionId ? eq(conversations.connectionId, connectionId) : isNull(conversations.connectionId)))
      .limit(1);
    if (existing) return existing;
    const [c] = await tx
      .insert(conversations)
      .values({
        tenantId: auth.tenantId,
        contactId: d.contactId,
        dealId: d.id,
        connectionId,
        channel: "WHATSAPP",
        assignedToId: auth.userId,
        // conversa iniciada pelo vendedor: o robô não entra quando o lead responder
        botState: { flowId: "", nodeId: "", vars: {}, done: true },
      })
      .returning({ id: conversations.id });
    return c;
  });
  emitToTenant(auth.tenantId, "conversation:updated", conv);
  return conv;
});
