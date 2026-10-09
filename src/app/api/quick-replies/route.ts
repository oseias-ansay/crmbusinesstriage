import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db";
import { quickReplies } from "@/db/schema";
import { parseBody, route } from "@/lib/api";

export const GET = route(async (_req, { auth }) =>
  withTenant(auth.tenantId, (tx) => tx.select().from(quickReplies).where(eq(quickReplies.tenantId, auth.tenantId)).orderBy(asc(quickReplies.shortcut))),
);

const schema = z.object({ shortcut: z.string().regex(/^\/[\w-]+$/), title: z.string().min(1), content: z.string().min(1) });
export const POST = route(async (req, { auth }) => {
  const body = await parseBody(req, schema);
  return withTenant(auth.tenantId, async (tx) => (await tx.insert(quickReplies).values({ ...body, tenantId: auth.tenantId }).returning())[0]);
}, { minRole: "MANAGER" });
