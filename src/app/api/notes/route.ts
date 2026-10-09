/** POST /api/notes { content, dealId?, contactId? } — nota interna na visão 360° */
import { z } from "zod";
import { withTenant } from "@/db";
import { notes } from "@/db/schema";
import { parseBody, route } from "@/lib/api";
import { logActivity } from "@/lib/activity";

const schema = z.object({ content: z.string().min(1).max(10_000), dealId: z.string().uuid().nullish(), contactId: z.string().uuid().nullish(), pinned: z.boolean().optional() });

export const POST = route(async (req, { auth }) => {
  const body = await parseBody(req, schema);
  return withTenant(auth.tenantId, async (tx) => {
    const [n] = await tx.insert(notes).values({ ...body, tenantId: auth.tenantId, userId: auth.userId }).returning();
    await logActivity(tx, { tenantId: auth.tenantId, type: "NOTE", summary: body.content.slice(0, 140), dealId: body.dealId, contactId: body.contactId, userId: auth.userId });
    return n;
  });
});
