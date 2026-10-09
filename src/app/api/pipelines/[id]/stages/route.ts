/** POST: nova etapa no fim do funil · PUT { order: [stageIds] }: reordena */
import { and, eq, inArray, max } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db";
import { pipelines, stages } from "@/db/schema";
import { ApiError, notFound, parseBody, route } from "@/lib/api";
import { stageFields } from "@/lib/stage-schema";

export const POST = route<{ id: string }>(async (req, { auth, params }) => {
  const body = await parseBody(req, stageFields);
  if (body.isWon && body.isLost) throw new ApiError(422, "Uma etapa não pode ser de ganho e de perda ao mesmo tempo");
  return withTenant(auth.tenantId, async (tx) => {
    const [p] = await tx.select().from(pipelines).where(eq(pipelines.id, params.id)).limit(1);
    if (!p) notFound("Funil");
    const [{ m }] = await tx.select({ m: max(stages.order) }).from(stages).where(eq(stages.pipelineId, p.id));
    const [s] = await tx.insert(stages).values({ ...body, tenantId: auth.tenantId, pipelineId: p.id, order: (m ?? -1) + 1 }).returning();
    return s;
  });
}, { minRole: "ADMIN" });

export const PUT = route<{ id: string }>(async (req, { auth, params }) => {
  const { order } = await parseBody(req, z.object({ order: z.array(z.string().uuid()).min(1) }));
  return withTenant(auth.tenantId, async (tx) => {
    const rows = await tx.select({ id: stages.id }).from(stages).where(and(eq(stages.pipelineId, params.id), inArray(stages.id, order)));
    if (rows.length !== order.length) throw new ApiError(422, "Lista de etapas inválida");
    for (const [i, id] of order.entries()) await tx.update(stages).set({ order: i }).where(eq(stages.id, id));
    return { ok: true };
  });
}, { minRole: "ADMIN" });
