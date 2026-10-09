/** PATCH { name?, isDefault?, aiAutoMove? } · DELETE (só se não houver negócios no funil) */
import { and, count, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db";
import { deals, pipelines } from "@/db/schema";
import { ApiError, notFound, parseBody, route } from "@/lib/api";

const schema = z.object({ name: z.string().min(2).max(80).optional(), isDefault: z.boolean().optional(), aiAutoMove: z.boolean().optional() });

export const PATCH = route<{ id: string }>(async (req, { auth, params }) => {
  const body = await parseBody(req, schema);
  return withTenant(auth.tenantId, async (tx) => {
    if (body.isDefault) await tx.update(pipelines).set({ isDefault: false }).where(ne(pipelines.id, params.id));
    const [p] = await tx.update(pipelines).set(body).where(eq(pipelines.id, params.id)).returning();
    return p ?? notFound("Funil");
  });
}, { minRole: "ADMIN" });

export const DELETE = route<{ id: string }>(async (_req, { auth, params }) => {
  await withTenant(auth.tenantId, async (tx) => {
    const [p] = await tx.select().from(pipelines).where(eq(pipelines.id, params.id)).limit(1);
    if (!p) notFound("Funil");
    const [{ n }] = await tx.select({ n: count() }).from(deals).where(eq(deals.pipelineId, p.id));
    if (n > 0) throw new ApiError(409, `Este funil tem ${n} negócio(s). Mova-os para outro funil antes de excluir.`);
    const [{ others }] = await tx.select({ others: count() }).from(pipelines).where(ne(pipelines.id, p.id));
    if (others === 0) throw new ApiError(409, "É preciso manter pelo menos um funil");
    await tx.delete(pipelines).where(eq(pipelines.id, p.id));
    if (p.isDefault) {
      const [first] = await tx.select().from(pipelines).orderBy(pipelines.order).limit(1);
      if (first) await tx.update(pipelines).set({ isDefault: true }).where(and(eq(pipelines.id, first.id)));
    }
  });
  return { ok: true };
}, { minRole: "ADMIN" });
