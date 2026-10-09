/**
 * PATCH: edita a etapa · DELETE ?moveTo=<stageId>: exclui a etapa movendo
 * os negócios (e o histórico) para outra etapa do mesmo funil.
 */
import { and, count, eq, ne } from "drizzle-orm";
import { withTenant } from "@/db";
import { deals, stageHistory, stages } from "@/db/schema";
import { ApiError, notFound, parseBody, route } from "@/lib/api";
import { stageFields } from "@/lib/stage-schema";

export const PATCH = route<{ id: string }>(async (req, { auth, params }) => {
  const body = await parseBody(req, stageFields.partial());
  if (body.isWon && body.isLost) throw new ApiError(422, "Uma etapa não pode ser de ganho e de perda ao mesmo tempo");
  return withTenant(auth.tenantId, async (tx) => {
    const [s] = await tx.update(stages).set(body).where(eq(stages.id, params.id)).returning();
    return s ?? notFound("Etapa");
  });
}, { minRole: "ADMIN" });

export const DELETE = route<{ id: string }>(async (req, { auth, params }) => {
  const moveTo = new URL(req.url).searchParams.get("moveTo");
  await withTenant(auth.tenantId, async (tx) => {
    const [s] = await tx.select().from(stages).where(eq(stages.id, params.id)).limit(1);
    if (!s) notFound("Etapa");
    const [{ others }] = await tx.select({ others: count() }).from(stages).where(and(eq(stages.pipelineId, s.pipelineId), ne(stages.id, s.id)));
    if (others === 0) throw new ApiError(409, "O funil precisa ter pelo menos uma etapa");
    const [{ n }] = await tx.select({ n: count() }).from(deals).where(eq(deals.stageId, s.id));
    if (n > 0) {
      if (!moveTo) throw new ApiError(409, `Esta etapa tem ${n} negócio(s). Escolha para qual etapa movê-los.`);
      const [target] = await tx.select().from(stages).where(and(eq(stages.id, moveTo), eq(stages.pipelineId, s.pipelineId), ne(stages.id, s.id))).limit(1);
      if (!target) throw new ApiError(422, "Etapa de destino inválida");
      await tx.update(deals).set({ stageId: target.id }).where(eq(deals.stageId, s.id));
      await tx.update(stageHistory).set({ toStageId: target.id }).where(eq(stageHistory.toStageId, s.id));
    }
    await tx.delete(stages).where(eq(stages.id, s.id));
  });
  return { ok: true };
}, { minRole: "ADMIN" });
