import { eq } from "drizzle-orm";
import { withTenant } from "@/db";
import { automations, type AutomationAction } from "@/db/schema";
import { notFound, parseBody, route } from "@/lib/api";
import { automationSchema } from "@/lib/validators";

export const PATCH = route<{ id: string }>(async (req, { auth, params }) => {
  const { actionsJson, ...body } = await parseBody(req, automationSchema.partial());
  return withTenant(auth.tenantId, async (tx) => {
    const [a] = await tx
      .update(automations)
      .set({ ...body, ...(actionsJson && { actionsJson: actionsJson as AutomationAction[] }) })
      .where(eq(automations.id, params.id))
      .returning();
    return a ?? notFound("Automação");
  });
}, { minRole: "MANAGER" });

export const DELETE = route<{ id: string }>(async (_req, { auth, params }) => {
  await withTenant(auth.tenantId, (tx) => tx.delete(automations).where(eq(automations.id, params.id)));
  return { ok: true };
}, { minRole: "MANAGER" });
