import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db";
import { botFlows } from "@/db/schema";
import { parseBody, route } from "@/lib/api";

export const GET = route(async (_req, { auth }) =>
  withTenant(auth.tenantId, (tx) => tx.select().from(botFlows).where(eq(botFlows.tenantId, auth.tenantId)).orderBy(desc(botFlows.updatedAt))),
);

const schema = z.object({ name: z.string().min(2), channel: z.enum(["WHATSAPP", "INSTAGRAM", "WEBCHAT"]).default("WHATSAPP") });
export const POST = route(async (req, { auth }) => {
  const body = await parseBody(req, schema);
  return withTenant(auth.tenantId, async (tx) =>
    (
      await tx
        .insert(botFlows)
        .values({ ...body, tenantId: auth.tenantId, flow: { startNodeId: "n1", nodes: [{ id: "n1", type: "message", data: { text: "Olá! 👋" } }] } })
        .returning()
    )[0],
  );
}, { minRole: "MANAGER" });
