/**
 * Regras de negócio de Deals (Leads/Negócios), reutilizadas pela API,
 * pelo Inbox (lead entrando pelo WhatsApp) e pelas automações.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db";
import { contacts, dealTags, deals, pipelines, stageHistory, stages, tags } from "@/db/schema";
import { ApiError } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { normalizePhone } from "@/lib/utils";

const GAP = 1024;

/** Calcula posição fracionária entre dois cards (evita reordenar a coluna inteira). */
export async function computePosition(tx: Tx, stageId: string, aboveId?: string | null, belowId?: string | null) {
  const ids = [aboveId, belowId].filter(Boolean) as string[];
  const rows = ids.length
    ? await tx.select({ id: deals.id, position: deals.position }).from(deals).where(inArray(deals.id, ids))
    : [];
  const above = rows.find((r) => r.id === aboveId)?.position;
  const below = rows.find((r) => r.id === belowId)?.position;
  if (above != null && below != null) return (above + below) / 2;
  if (above != null) return above + GAP;
  if (below != null) return below - GAP;
  // sem referência → vai para o topo da coluna
  const [last] = await tx
    .select({ position: deals.position })
    .from(deals)
    .where(eq(deals.stageId, stageId))
    .orderBy(asc(deals.position))
    .limit(1);
  return last ? last.position - GAP : GAP;
}

export async function ensureTags(tx: Tx, tenantId: string, names: string[]) {
  if (!names.length) return [];
  await tx
    .insert(tags)
    .values(names.map((name) => ({ tenantId, name })))
    .onConflictDoNothing();
  return tx.select().from(tags).where(and(eq(tags.tenantId, tenantId), inArray(tags.name, names)));
}

export async function defaultPipelineFirstStage(tx: Tx, tenantId: string) {
  const [row] = await tx
    .select({ pipelineId: pipelines.id, stageId: stages.id })
    .from(pipelines)
    .innerJoin(stages, eq(stages.pipelineId, pipelines.id))
    .where(eq(pipelines.tenantId, tenantId))
    .orderBy(desc(pipelines.isDefault), asc(pipelines.order), asc(stages.order))
    .limit(1);
  return row ?? null;
}

type CreateInput = {
  title: string;
  pipelineId: string;
  stageId: string;
  value?: number;
  recurring?: boolean;
  userId?: string | null;
  expectedCloseAt?: Date | null;
  source?: string | null;
  customFields?: Record<string, unknown>;
  tags?: string[];
  contactId?: string | null;
  contact?: { name: string; email?: string | null; phone?: string | null };
};

export async function createDeal(tx: Tx, tenantId: string, actorId: string | null, input: CreateInput) {
  const [stage] = await tx
    .select()
    .from(stages)
    .where(and(eq(stages.id, input.stageId), eq(stages.pipelineId, input.pipelineId)))
    .limit(1);
  if (!stage) throw new ApiError(422, "Etapa não pertence ao pipeline");

  let contactId = input.contactId ?? null;
  if (!contactId && input.contact) {
    const [c] = await tx
      .insert(contacts)
      .values({
        tenantId,
        name: input.contact.name,
        email: input.contact.email || null,
        phone: normalizePhone(input.contact.phone),
        ownerId: input.userId ?? actorId,
        source: input.source,
      })
      .returning();
    contactId = c.id;
  }

  const position = await computePosition(tx, stage.id);
  const [deal] = await tx
    .insert(deals)
    .values({
      tenantId,
      pipelineId: input.pipelineId,
      stageId: stage.id,
      contactId,
      userId: input.userId ?? actorId,
      title: input.title,
      value: String(input.value ?? 0),
      recurring: input.recurring ?? false,
      expectedCloseAt: input.expectedCloseAt ?? null,
      source: input.source ?? null,
      customFields: input.customFields ?? {},
      position,
      status: stage.isWon ? "WON" : stage.isLost ? "LOST" : "OPEN",
    })
    .returning();

  if (input.tags?.length) {
    const t = await ensureTags(tx, tenantId, input.tags);
    await tx.insert(dealTags).values(t.map((tag) => ({ tenantId, dealId: deal.id, tagId: tag.id }))).onConflictDoNothing();
  }
  await tx.insert(stageHistory).values({ tenantId, dealId: deal.id, toStageId: stage.id, userId: actorId });
  await logActivity(tx, { tenantId, type: "DEAL_CREATED", summary: `Negócio criado em "${stage.name}"`, dealId: deal.id, contactId, userId: actorId });
  return deal;
}

export async function moveDeal(
  tx: Tx,
  tenantId: string,
  actorId: string | null,
  dealId: string,
  toStageId: string,
  aboveId?: string | null,
  belowId?: string | null,
) {
  const [deal] = await tx.select().from(deals).where(eq(deals.id, dealId)).for("update").limit(1);
  if (!deal) throw new ApiError(404, "Negócio não encontrado");
  const [to] = await tx.select().from(stages).where(eq(stages.id, toStageId)).limit(1);
  if (!to) throw new ApiError(404, "Etapa não encontrada");

  const position = await computePosition(tx, to.id, aboveId, belowId);
  const stageChanged = deal.stageId !== to.id;
  const now = new Date();
  const status = to.isWon ? "WON" : to.isLost ? "LOST" : "OPEN";

  const [updated] = await tx
    .update(deals)
    .set({
      stageId: to.id,
      pipelineId: to.pipelineId,
      position,
      ...(stageChanged && {
        stageEnteredAt: now,
        status,
        closedAt: status === "OPEN" ? null : now,
      }),
    })
    .where(eq(deals.id, dealId))
    .returning();

  if (stageChanged) {
    const durationSec = Math.round((now.getTime() - deal.stageEnteredAt.getTime()) / 1000);
    await tx.insert(stageHistory).values({ tenantId, dealId, fromStageId: deal.stageId, toStageId: to.id, userId: actorId, durationSec });
    await logActivity(tx, {
      tenantId,
      type: status === "WON" ? "DEAL_WON" : status === "LOST" ? "DEAL_LOST" : "STAGE_CHANGE",
      summary: `Movido para "${to.name}"`,
      dealId,
      contactId: deal.contactId,
      userId: actorId,
      meta: { from: deal.stageId, to: to.id },
    });
  }
  return { deal: updated, stageChanged, fromStageId: deal.stageId, status };
}
