/** PATCH /api/conversations/:id { assignedToId?, status?, markRead? } */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db";
import { conversations } from "@/db/schema";
import { notFound, parseBody, route } from "@/lib/api";
import { emitToTenant } from "@/lib/realtime";
import { notify } from "@/lib/activity";

const schema = z.object({
  assignedToId: z.string().uuid().nullish(),
  status: z.enum(["OPEN", "PENDING", "RESOLVED"]).optional(),
  markRead: z.boolean().optional(),
});

export const PATCH = route<{ id: string }>(async (req, { auth, params }) => {
  const body = await parseBody(req, schema);
  const conv = await withTenant(auth.tenantId, async (tx) => {
    const patch: Partial<typeof conversations.$inferInsert> = {};
    if (body.assignedToId !== undefined) {
      patch.assignedToId = body.assignedToId;
      patch.botState = { flowId: "", nodeId: "", vars: {}, done: true }; // humano assumiu → bot para
    }
    if (body.status) patch.status = body.status;
    if (body.markRead) patch.unreadCount = 0;
    const [c] = await tx.update(conversations).set(patch).where(eq(conversations.id, params.id)).returning();
    if (!c) notFound("Conversa");
    if (body.assignedToId && body.assignedToId !== auth.userId) {
      await notify(tx, { tenantId: auth.tenantId, userId: body.assignedToId, title: "Conversa atribuída a você", link: `/inbox?c=${c.id}` });
    }
    return c;
  });
  emitToTenant(auth.tenantId, "conversation:updated", conv);
  return conv;
});
