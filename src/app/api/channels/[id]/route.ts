/** PATCH /api/channels/:id { name?, isActive?, routing? } — nome e roteamento de entrada do número. */
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db";
import { botFlows, channelConnections, pipelines } from "@/db/schema";
import { ApiError, notFound, parseBody, route } from "@/lib/api";

type P = { id: string };
const target = { pipelineId: z.string().uuid().optional().or(z.literal("")), botFlowId: z.union([z.string().uuid(), z.literal("none"), z.literal("")]).optional() };
const schema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  isActive: z.boolean().optional(),
  routing: z.object({ ...target, rules: z.array(z.object({ match: z.string().trim().min(2).max(300), ...target })).max(20).optional() }).optional(),
});

export const PATCH = route<P>(async (req, { auth, params }) => {
  const b = await parseBody(req, schema);
  return withTenant(auth.tenantId, async (tx) => {
    if (b.routing) {
      const all = [b.routing, ...(b.routing.rules ?? [])];
      const pids = [...new Set(all.map((x) => x.pipelineId).filter(Boolean) as string[])];
      const bids = [...new Set(all.map((x) => x.botFlowId).filter((x) => x && x !== "none") as string[])];
      if (pids.length && (await tx.select({ id: pipelines.id }).from(pipelines).where(and(eq(pipelines.tenantId, auth.tenantId), inArray(pipelines.id, pids)))).length !== pids.length) throw new ApiError(422, "Funil inválido");
      if (bids.length && (await tx.select({ id: botFlows.id }).from(botFlows).where(and(eq(botFlows.tenantId, auth.tenantId), inArray(botFlows.id, bids)))).length !== bids.length) throw new ApiError(422, "Robô inválido");
    }
    const clean = (x: { pipelineId?: string; botFlowId?: string }) => ({ ...(x.pipelineId && { pipelineId: x.pipelineId }), ...(x.botFlowId && { botFlowId: x.botFlowId }) });
    const [c] = await tx
      .update(channelConnections)
      .set({
        ...(b.name && { name: b.name }),
        ...(b.isActive !== undefined && { isActive: b.isActive }),
        ...(b.routing && { routing: { ...clean(b.routing), rules: (b.routing.rules ?? []).map((r) => ({ match: r.match, ...clean(r) })) } }),
      })
      .where(and(eq(channelConnections.id, params.id), eq(channelConnections.tenantId, auth.tenantId)))
      .returning();
    if (!c) notFound("Conexão");
    return { id: c.id, name: c.name, routing: c.routing, isActive: c.isActive };
  });
}, { minRole: "ADMIN" });
