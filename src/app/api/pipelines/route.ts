/** GET: pipelines com etapas · POST: cria pipeline com etapas */
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db";
import { pipelines, stages } from "@/db/schema";
import { parseBody, route } from "@/lib/api";

export const GET = route(async (_req, { auth }) =>
  withTenant(auth.tenantId, (tx) =>
    tx.query.pipelines.findMany({
      where: eq(pipelines.tenantId, auth.tenantId),
      orderBy: asc(pipelines.order),
      with: { stages: { orderBy: asc(stages.order) } },
    }),
  ),
);

const schema = z.object({
  name: z.string().min(2),
  stages: z
    .array(z.object({ name: z.string().min(1), color: z.string().default("#94A3B8"), probability: z.number().min(0).max(100).default(0), isWon: z.boolean().optional(), isLost: z.boolean().optional() }))
    .min(1),
});

export const POST = route(
  async (req, { auth }) => {
    const body = await parseBody(req, schema);
    return withTenant(auth.tenantId, async (tx) => {
      const [p] = await tx.insert(pipelines).values({ tenantId: auth.tenantId, name: body.name, order: 99 }).returning();
      const st = await tx
        .insert(stages)
        .values(body.stages.map((s, order) => ({ ...s, tenantId: auth.tenantId, pipelineId: p.id, order })))
        .returning();
      return { ...p, stages: st };
    });
  },
  { minRole: "ADMIN" },
);
