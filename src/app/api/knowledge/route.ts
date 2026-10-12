/** GET documentos da base de conhecimento · POST novo documento. */
import { asc, eq } from "drizzle-orm";
import { withTenant } from "@/db";
import { knowledgeDocs } from "@/db/schema";
import { parseBody, route } from "@/lib/api";
import { CATEGORIES, FULL_LIMIT, docSchema } from "@/lib/copilot/knowledge";


export const GET = route(async (_req, { auth }) =>
  withTenant(auth.tenantId, async (tx) => {
    const docs = await tx.select().from(knowledgeDocs).where(eq(knowledgeDocs.tenantId, auth.tenantId)).orderBy(asc(knowledgeDocs.createdAt));
    return { docs, categories: CATEGORIES, fullLimit: FULL_LIMIT };
  }),
{ minRole: "MANAGER" });

export const POST = route(async (req, { auth }) => {
  const body = await parseBody(req, docSchema);
  return withTenant(auth.tenantId, async (tx) => {
    const [d] = await tx.insert(knowledgeDocs).values({ ...body, tenantId: auth.tenantId }).returning();
    return d;
  });
}, { minRole: "MANAGER" });
