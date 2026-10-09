/**
 * Mensageria do Inbox:
 *  - sendOutbound(): grava a mensagem, envia ao canal e emite via socket
 *  - handleInbound(): processa mensagem recebida (webhook) → contato,
 *    conversa, lead no funil, bot de triagem e automações
 */
import { and, eq, ne, sql } from "drizzle-orm";
import { withAdmin, withTenant, type Tx } from "@/db";
import { channelConnections, contacts, conversations, deals, messages, type Attribution, type Conversation } from "@/db/schema";
import { deliverToChannel } from "@/lib/channels";
import { emitToTenant } from "@/lib/realtime";
import { runBot } from "@/lib/bot/engine";
import { createDeal, defaultPipelineFirstStage } from "./deals";
import { fireTrigger } from "@/lib/automation/engine";

type Outbound = {
  tenantId: string;
  conversationId: string;
  senderType: "USER" | "BOT" | "SYSTEM";
  userId?: string | null;
  content: string;
  type?: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT";
  mediaUrl?: string | null;
  mediaMime?: string | null;
  isInternalNote?: boolean;
};

export async function sendOutbound(tx: Tx, o: Outbound) {
  const [conv] = await tx.select().from(conversations).where(eq(conversations.id, o.conversationId)).limit(1);
  if (!conv) throw new Error("Conversa não encontrada");

  const [msg] = await tx
    .insert(messages)
    .values({
      tenantId: o.tenantId,
      conversationId: conv.id,
      dealId: conv.dealId,
      userId: o.userId ?? null,
      channel: conv.channel,
      senderType: o.senderType,
      type: o.type ?? "TEXT",
      content: o.content,
      mediaUrl: o.mediaUrl ?? null,
      mediaMime: o.mediaMime ?? null,
      isInternalNote: o.isInternalNote ?? false,
      status: o.isInternalNote ? "SENT" : "PENDING",
    })
    .returning();

  if (!o.isInternalNote) {
    try {
      const { externalId } = await deliverToChannel(tx, conv.id, { text: o.content, type: o.type, mediaUrl: o.mediaUrl, mediaMime: o.mediaMime });
      // Se a "cópia" desta mesma mensagem (eco do webhook) já foi gravada por outra
      // transação, remove o eco antes de assumir o externalId (evita conflito de índice único).
      if (externalId) {
        await tx.delete(messages).where(and(eq(messages.externalId, externalId), eq(messages.senderType, "SYSTEM"), ne(messages.id, msg.id)));
      }
      await tx.update(messages).set({ status: "SENT", externalId: externalId ?? null }).where(eq(messages.id, msg.id));
      msg.status = "SENT";
    } catch (e) {
      console.error("[send]", e);
      await tx.update(messages).set({ status: "FAILED" }).where(eq(messages.id, msg.id));
      msg.status = "FAILED";
    }
    await tx
      .update(conversations)
      .set({ lastMessageAt: new Date(), lastMessagePreview: o.content.slice(0, 120) || `[${o.type}]`, status: "OPEN" })
      .where(eq(conversations.id, conv.id));
  }

  emitToTenant(o.tenantId, "message:new", { conversationId: conv.id, message: msg });
  return msg;
}

type Inbound = {
  tenantId: string;
  channel: Conversation["channel"];
  connectionId?: string | null;
  externalId: string;
  // identidade do contato no canal
  phone?: string | null;
  email?: string | null;
  instagramId?: string | null;
  name: string;
  type: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT";
  content: string;
  mediaUrl?: string | null;
  /** true = mensagem enviada pelo número (n8n/celular), apenas registrada */
  fromMe?: boolean;
  /** veio de anúncio (Clique para WhatsApp) */
  attribution?: Attribution | null;
};

/** Junta a atribuição nova com a existente: guarda o 1º contato e atualiza o último clique. */
export function mergeAttribution(prev: Attribution | null | undefined, next: Attribution): Attribution {
  const p = prev ?? {};
  return { ...p, ...Object.fromEntries(Object.entries(next).filter(([, v]) => v != null)), firstAt: p.firstAt ?? next.firstAt, lastAt: next.lastAt ?? new Date().toISOString() };
}

/**
 * Registra mensagem que saiu do número fora do CRM (bot do n8n, celular).
 * Não cria negócio, não conta como não lida e não dispara bot/automações.
 * Mensagens enviadas pelo próprio CRM voltam pelo webhook e são ignoradas
 * pelo dedupe (mesmo externalId).
 */
async function recordOutboundEcho(i: Inbound) {
  // O eco de uma mensagem enviada pelo próprio CRM pode chegar antes de o envio
  // terminar de gravar o externalId. Esperar um pouco deixa o dedupe enxergá-lo.
  await new Promise((r) => setTimeout(r, 2500));
  return withTenant(i.tenantId, async (tx) => {
    const [dup] = await tx.select({ id: messages.id }).from(messages).where(eq(messages.externalId, i.externalId)).limit(1);
    if (dup || !i.phone) return null;
    let [contact] = await tx.select().from(contacts).where(eq(contacts.phone, i.phone)).limit(1);
    if (!contact) {
      [contact] = await tx.insert(contacts).values({ tenantId: i.tenantId, name: i.name, phone: i.phone, source: "whatsapp" }).returning();
    }
    let [conv] = await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.contactId, contact.id), eq(conversations.channel, i.channel)))
      .orderBy(sql`${conversations.lastMessageAt} desc`)
      .limit(1);
    if (!conv) {
      const [openDeal] = await tx.select({ id: deals.id }).from(deals).where(and(eq(deals.contactId, contact.id), ne(deals.status, "LOST"))).limit(1);
      [conv] = await tx
        .insert(conversations)
        .values({ tenantId: i.tenantId, contactId: contact.id, dealId: openDeal?.id ?? null, connectionId: i.connectionId ?? null, channel: i.channel })
        .returning();
    }
    const [msg] = await tx
      .insert(messages)
      .values({
        tenantId: i.tenantId,
        conversationId: conv.id,
        dealId: conv.dealId,
        channel: i.channel,
        senderType: "SYSTEM",
        type: i.type,
        content: i.content,
        mediaUrl: i.mediaUrl ?? null,
        externalId: i.externalId,
        status: "SENT",
      })
      .onConflictDoNothing()
      .returning();
    if (!msg) return null; // o CRM gravou a mesma mensagem no meio do caminho
    await tx
      .update(conversations)
      .set({ lastMessageAt: new Date(), lastMessagePreview: i.content.slice(0, 120) || `[${i.type}]` })
      .where(eq(conversations.id, conv.id));
    emitToTenant(i.tenantId, "message:new", { conversationId: conv.id, message: msg });
    return msg;
  });
}

export async function handleInbound(i: Inbound) {
  if (i.fromMe) return recordOutboundEcho(i);
  const result = await withTenant(i.tenantId, async (tx) => {
    // 1) Dedupe: provedores reenviam webhooks
    const [dup] = await tx.select({ id: messages.id }).from(messages).where(eq(messages.externalId, i.externalId)).limit(1);
    if (dup) return null;

    // 2) Contato (por telefone, e-mail ou id do Instagram)
    const where = i.phone
      ? eq(contacts.phone, i.phone)
      : i.email
        ? eq(contacts.email, i.email)
        : sql`${contacts.customFields}->>'instagram_id' = ${i.instagramId}`;
    let [contact] = await tx.select().from(contacts).where(where).limit(1);
    let isNewContact = false;
    if (!contact) {
      [contact] = await tx
        .insert(contacts)
        .values({
          tenantId: i.tenantId,
          name: i.name,
          phone: i.phone ?? null,
          email: i.email ?? null,
          source: i.attribution ? "meta_ads" : i.channel.toLowerCase(),
          customFields: i.instagramId ? { instagram_id: i.instagramId } : {},
          attribution: i.attribution ?? {},
        })
        .returning();
      isNewContact = true;
    } else if (i.attribution) {
      [contact] = await tx
        .update(contacts)
        .set({ attribution: mergeAttribution(contact.attribution, i.attribution) })
        .where(eq(contacts.id, contact.id))
        .returning();
    }

    // 3) Conversa aberta do canal (reabre se resolvida)
    let [conv] = await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.contactId, contact.id), eq(conversations.channel, i.channel)))
      .orderBy(sql`${conversations.lastMessageAt} desc`)
      .limit(1);

    // 4) Lead novo → cria negócio na 1ª etapa do pipeline padrão
    let newDealId: string | null = null;
    if (!conv) {
      let dealId: string | null = null;
      const [openDeal] = await tx
        .select({ id: deals.id })
        .from(deals)
        .where(and(eq(deals.contactId, contact.id), ne(deals.status, "LOST")))
        .limit(1);
      dealId = openDeal?.id ?? null;
      if (!dealId) {
        const target = await defaultPipelineFirstStage(tx, i.tenantId);
        if (target) {
          const d = await createDeal(tx, i.tenantId, null, {
            title: `Lead ${i.channel === "WHATSAPP" ? "WhatsApp" : i.channel === "INSTAGRAM" ? "Instagram" : "E-mail"} — ${contact.name}`,
            pipelineId: target.pipelineId,
            stageId: target.stageId,
            contactId: contact.id,
            source: i.attribution ? "meta_ads" : i.channel.toLowerCase(),
            userId: null,
          });
          dealId = d.id;
          newDealId = d.id;
        }
      }
      [conv] = await tx
        .insert(conversations)
        .values({ tenantId: i.tenantId, contactId: contact.id, dealId, connectionId: i.connectionId ?? null, channel: i.channel })
        .returning();
    }

    // 5) Grava mensagem recebida
    const [msg] = await tx
      .insert(messages)
      .values({
        tenantId: i.tenantId,
        conversationId: conv.id,
        dealId: conv.dealId,
        channel: i.channel,
        senderType: "CONTACT",
        type: i.type,
        content: i.content,
        mediaUrl: i.mediaUrl ?? null,
        externalId: i.externalId,
        status: "RECEIVED",
      })
      .returning();
    const [updatedConv] = await tx
      .update(conversations)
      .set({
        unreadCount: sql`${conversations.unreadCount} + 1`,
        lastMessageAt: new Date(),
        lastMessagePreview: i.content.slice(0, 120) || `[${i.type}]`,
        status: "OPEN",
      })
      .where(eq(conversations.id, conv.id))
      .returning();

    emitToTenant(i.tenantId, "message:new", { conversationId: conv.id, message: msg, conversation: updatedConv });
    if (newDealId) emitToTenant(i.tenantId, "deal:created", { id: newDealId });

    // 6) Robô de triagem
    const bot = await runBot(tx, updatedConv, i.content);
    for (const text of bot.replies) {
      await sendOutbound(tx, { tenantId: i.tenantId, conversationId: conv.id, senderType: "BOT", content: text });
    }
    return { contact, conv: updatedConv, newDealId, isNewContact, botTriggers: bot.triggers };
  });

  if (result) {
    fireTrigger(i.tenantId, "MESSAGE_RECEIVED", { contactId: result.contact.id, dealId: result.conv.dealId ?? undefined });
    if (result.newDealId) fireTrigger(i.tenantId, "DEAL_CREATED", { dealId: result.newDealId, contactId: result.contact.id });
    for (const t of result.botTriggers) fireTrigger(i.tenantId, t.type, t.ctx);
  }
  return result;
}

/** Usado pelos webhooks: descobre o tenant pela conexão de canal. */
export async function resolveConnection(channel: Conversation["channel"], externalId: string) {
  return withAdmin(async (tx) => {
    const [conn] = await tx
      .select()
      .from(channelConnections)
      .where(and(eq(channelConnections.channel, channel), eq(channelConnections.externalId, externalId), eq(channelConnections.isActive, true)))
      .limit(1);
    return conn ?? null;
  });
}
