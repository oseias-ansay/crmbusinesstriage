/** GET (visão 360° do negócio) · PATCH (editar/ganhar/perder) · DELETE */
import { and, desc, eq } from "drizzle-orm";
import { withTenant } from "@/db";
import { activities, dealTags, deals, messages, notes, stages, tasks } from "@/db/schema";
import { notFound, parseBody, route } from "@/lib/api";
import { dealUpdateSchema } from "@/lib/validators";
import { ensureTags } from "@/lib/services/deals";
import { logActivity } from "@/lib/activity";
import { emitToTenant } from "@/lib/realtime";
import { fireTrigger } from "@/lib/automation/engine";

type P = { id: string };

export const GET = route<P>(async (_req, { auth, params }) =>
  withTenant(auth.tenantId, async (tx) => {
    const deal = await tx.query.deals.findFirst({
      where: eq(deals.id, params.id),
      with: {
        contact: { with: { organization: true } },
        user: { columns: { id: true, name: true, avatarUrl: true } },
        stage: true,
        pipeline: true,
        lossReason: true,
        tags: { with: { tag: true } },
        tasks: { orderBy: desc(tasks.dueDate) },
        notes: { orderBy: desc(notes.createdAt), with: { user: { columns: { name: true } } } },
        attachments: true,
        activities: { orderBy: desc(activities.createdAt), limit: 100 },
        stageHistory: { with: { fromStage: true, toStage: true } },
      },
    });
    if (!deal) notFound("Negócio");
    const timeline = await tx.select().from(messages).where(eq(messages.dealId, deal.id)).orderBy(desc(messages.timestamp)).limit(50);
    return { ...deal, messages: timeline };
  }),
);

export const PATCH = route<P>(async (req, { auth, params }) => {
  const body = await parseBody(req, dealUpdateSchema);
  const { tags: tagNames, value, ...rest } = body;

  const { deal, prevStatus } = await withTenant(auth.tenantId, async (tx) => {
    const [prev] = await tx.select().from(deals).where(eq(deals.id, params.id)).limit(1);
    if (!prev) notFound("Negócio");

    const patch: Partial<typeof deals.$inferInsert> = { ...rest, ...(value != null && { value: String(value) }) };

    // Ganhar/perder pelo botão: move para a etapa Ganho/Perdido do pipeline, se existir
    if (body.status && body.status !== prev.status) {
      patch.closedAt = body.status === "OPEN" ? null : new Date();
      if (body.status !== "OPEN") {
        const [target] = await tx
          .select()
          .from(stages)
          .where(and(eq(stages.pipelineId, prev.pipelineId), body.status === "WON" ? eq(stages.isWon, true) : eq(stages.isLost, true)))
          .limit(1);
        if (target) Object.assign(patch, { stageId: target.id, stageEnteredAt: new Date() });
      }
      await logActivity(tx, {
        tenantId: auth.tenantId,
        type: body.status === "WON" ? "DEAL_WON" : body.status === "LOST" ? "DEAL_LOST" : "STAGE_CHANGE",
        summary: body.status === "WON" ? "Negócio ganho 🎉" : body.status === "LOST" ? `Negócio perdido${body.lossNote ? `: ${body.lossNote}` : ""}` : "Negócio reaberto",
        dealId: prev.id,
        contactId: prev.contactId,
        userId: auth.userId,
      });
    }
    if (body.userId && body.userId !== prev.userId) {
      await logActivity(tx, { tenantId: auth.tenantId, type: "ASSIGNMENT", summary: "Responsável alterado", dealId: prev.id, userId: auth.userId, meta: { from: prev.userId, to: body.userId } });
    }

    const [deal] = await tx.update(deals).set(patch).where(eq(deals.id, params.id)).returning();

    if (tagNames) {
      const before = await tx.select({ tagId: dealTags.tagId }).from(dealTags).where(eq(dealTags.dealId, deal.id));
      const prevIds = new Set(before.map((b) => b.tagId));
      await tx.delete(dealTags).where(eq(dealTags.dealId, deal.id));
      const t = await ensureTags(tx, auth.tenantId, tagNames);
      if (t.length) await tx.insert(dealTags).values(t.map((tag) => ({ tenantId: auth.tenantId, dealId: deal.id, tagId: tag.id })));
      // somente tags realmente novas disparam TAG_ADDED
      for (const tag of t) if (!prevIds.has(tag.id)) fireTrigger(auth.tenantId, "TAG_ADDED", { dealId: deal.id, tagName: tag.name });
    }
    return { deal, prevStatus: prev.status };
  });

  emitToTenant(auth.tenantId, "deal:updated", deal);
  if (deal.status !== prevStatus) {
    if (deal.status === "WON") fireTrigger(auth.tenantId, "DEAL_WON", { dealId: deal.id, value: Number(deal.value) });
    if (deal.status === "LOST") fireTrigger(auth.tenantId, "DEAL_LOST", { dealId: deal.id });
  }
  return deal;
});

export const DELETE = route<P>(async (_req, { auth, params }) => {
  await withTenant(auth.tenantId, (tx) => tx.delete(deals).where(eq(deals.id, params.id)));
  emitToTenant(auth.tenantId, "deal:deleted", { id: params.id });
  return { ok: true };
}, { minRole: "MANAGER" });
