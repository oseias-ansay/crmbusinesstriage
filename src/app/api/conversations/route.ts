/** GET /api/conversations?status=OPEN&channel=WHATSAPP&mine=1&q= — lista do Inbox */
import { and, desc, eq, ilike, isNull, or, type SQL } from "drizzle-orm";
import { withTenant } from "@/db";
import { contacts, conversations, deals, users } from "@/db/schema";
import { route } from "@/lib/api";

export const GET = route(async (req, { auth }) => {
  const sp = new URL(req.url).searchParams;
  const f: SQL[] = [eq(conversations.tenantId, auth.tenantId)];
  const status = sp.get("status");
  if (status && status !== "ALL") f.push(eq(conversations.status, status as "OPEN"));
  if (sp.get("channel")) f.push(eq(conversations.channel, sp.get("channel") as "WHATSAPP"));
  if (sp.get("mine") === "1") f.push(eq(conversations.assignedToId, auth.userId));
  if (sp.get("unassigned") === "1") f.push(isNull(conversations.assignedToId));
  if (sp.get("q")) f.push(or(ilike(contacts.name, `%${sp.get("q")}%`), ilike(contacts.phone, `%${sp.get("q")}%`))!);
  // Agente vê as suas + as não atribuídas (fila)
  if (auth.role === "AGENT") f.push(or(eq(conversations.assignedToId, auth.userId), isNull(conversations.assignedToId))!);

  return withTenant(auth.tenantId, (tx) =>
    tx
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
        contact: { id: contacts.id, name: contacts.name, phone: contacts.phone, email: contacts.email },
      })
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .leftJoin(users, eq(users.id, conversations.assignedToId))
      .leftJoin(deals, eq(deals.id, conversations.dealId))
      .where(and(...f))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(200),
  );
});
