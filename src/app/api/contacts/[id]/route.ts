/** Visão 360° do contato: dados, negócios, conversas, tarefas, notas, arquivos e timeline. */
import { desc, eq, inArray } from "drizzle-orm";
import { withTenant } from "@/db";
import { activities, contactTags, contacts, conversations, deals, messages, notes, tasks } from "@/db/schema";
import { notFound, parseBody, route } from "@/lib/api";
import { contactSchema } from "@/lib/validators";
import { ensureTags } from "@/lib/services/deals";
import { normalizePhone } from "@/lib/utils";
import { fireTrigger } from "@/lib/automation/engine";

type P = { id: string };

export const GET = route<P>(async (_req, { auth, params }) =>
  withTenant(auth.tenantId, async (tx) => {
    const contact = await tx.query.contacts.findFirst({
      where: eq(contacts.id, params.id),
      with: {
        organization: true,
        owner: { columns: { id: true, name: true } },
        tags: { with: { tag: true } },
        deals: { with: { stage: true, pipeline: true }, orderBy: desc(deals.createdAt) },
        tasks: { orderBy: desc(tasks.dueDate), with: { user: { columns: { name: true } } } },
        notes: { orderBy: desc(notes.createdAt), with: { user: { columns: { name: true } } } },
        attachments: true,
        activities: { orderBy: desc(activities.createdAt), limit: 200 },
        conversations: true,
      },
    });
    if (!contact) notFound("Contato");
    const convIds = contact.conversations.map((c) => c.id);
    const msgs = convIds.length
      ? await tx.select().from(messages).where(inArray(messages.conversationId, convIds)).orderBy(desc(messages.timestamp)).limit(200)
      : [];

    // Timeline unificada (atividades + mensagens), mais recente primeiro
    const timeline = [
      ...contact.activities.map((a) => ({ kind: "activity" as const, at: a.createdAt, type: a.type, text: a.summary })),
      ...msgs.map((m) => ({ kind: "message" as const, at: m.timestamp, type: m.channel, text: m.content, from: m.senderType })),
    ].sort((a, b) => +b.at - +a.at);

    return { ...contact, timeline };
  }),
);

export const PATCH = route<P>(async (req, { auth, params }) => {
  const body = await parseBody(req, contactSchema.partial());
  const { tags: tagNames, ...data } = body;
  const res = await withTenant(auth.tenantId, async (tx) => {
    const [c] = await tx
      .update(contacts)
      .set({ ...data, ...(data.phone !== undefined && { phone: normalizePhone(data.phone) }), ...(data.email === "" && { email: null }) })
      .where(eq(contacts.id, params.id))
      .returning();
    if (!c) notFound("Contato");
    const added: string[] = [];
    if (tagNames) {
      const prev = await tx.query.contactTags.findMany({ where: eq(contactTags.contactId, c.id), with: { tag: true } });
      const prevNames = new Set(prev.map((p) => p.tag.name));
      await tx.delete(contactTags).where(eq(contactTags.contactId, c.id));
      const tg = await ensureTags(tx, auth.tenantId, tagNames);
      if (tg.length) await tx.insert(contactTags).values(tg.map((x) => ({ tenantId: auth.tenantId, contactId: c.id, tagId: x.id })));
      added.push(...tagNames.filter((n) => !prevNames.has(n)));
    }
    return { c, added };
  });
  for (const tagName of res.added) fireTrigger(auth.tenantId, "TAG_ADDED", { contactId: res.c.id, tagName });
  return res.c;
});

export const DELETE = route<P>(async (_req, { auth, params }) => {
  await withTenant(auth.tenantId, (tx) => tx.delete(contacts).where(eq(contacts.id, params.id)));
  return { ok: true };
}, { minRole: "MANAGER" });

