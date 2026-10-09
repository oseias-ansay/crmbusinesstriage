/** PATCH /api/bots/:id { name?, isActive?, flow? } — valida o grafo antes de salvar */
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db";
import { botFlows } from "@/db/schema";
import { ApiError, notFound, parseBody, route } from "@/lib/api";

const node = z.object({ id: z.string(), type: z.enum(["message", "question", "choice", "condition", "action", "handoff", "qualify", "schedule", "live"]), data: z.record(z.any()), next: z.string().optional(), else: z.string().optional() });
const schema = z.object({
  name: z.string().min(2).optional(),
  isActive: z.boolean().optional(),
  flow: z.object({ startNodeId: z.string(), nodes: z.array(node).min(1).max(200) }).optional(),
});

export const PATCH = route<{ id: string }>(async (req, { auth, params }) => {
  const body = await parseBody(req, schema);
  if (body.flow) {
    const ids = new Set(body.flow.nodes.map((n) => n.id));
    if (!ids.has(body.flow.startNodeId)) throw new ApiError(422, "Nó inicial inexistente");
    for (const n of body.flow.nodes) {
      for (const ref of [n.next, n.else]) if (ref && ref !== "__end__" && !ids.has(ref)) throw new ApiError(422, `Nó ${n.id} aponta para ${ref}, que não existe`);
    }
  }
  return withTenant(auth.tenantId, async (tx) => {
    const [bot] = await tx.update(botFlows).set(body).where(eq(botFlows.id, params.id)).returning();
    if (!bot) notFound("Bot");
    // Só um bot ativo por canal
    if (body.isActive) {
      await tx.update(botFlows).set({ isActive: false }).where(and(eq(botFlows.channel, bot.channel), ne(botFlows.id, bot.id)));
    }
    return bot;
  });
}, { minRole: "MANAGER" });
