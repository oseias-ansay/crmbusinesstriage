import { desc, eq } from "drizzle-orm";
import { withTenant } from "@/db";
import { automations } from "@/db/schema";
import { parseBody, route } from "@/lib/api";
import { automationSchema } from "@/lib/validators";
import type { AutomationAction } from "@/db/schema";

export const GET = route(async (_req, { auth }) =>
  withTenant(auth.tenantId, (tx) =>
    tx.query.automations.findMany({
      where: eq(automations.tenantId, auth.tenantId),
      orderBy: desc(automations.createdAt),
      with: { logs: { limit: 5, orderBy: (l, { desc }) => desc(l.createdAt) } },
    }),
  ),
);

export const POST = route(async (req, { auth }) => {
  const body = await parseBody(req, automationSchema);
  return withTenant(auth.tenantId, async (tx) =>
    (await tx.insert(automations).values({ ...body, actionsJson: body.actionsJson as AutomationAction[], tenantId: auth.tenantId }).returning())[0],
  );
}, { minRole: "MANAGER" });
