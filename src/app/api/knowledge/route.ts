/** GET documentos da base de conhecimento · POST novo documento. */
import { asc, eq } from "drizzle-orm";
import { withTenant } from "@/db";
import { knowledgeDocs, pipelines } from "@/db/schema";
import { parseBody, route } from "@/lib/api";
import { CATEGORIES, FULL_LIMIT, docSchema } from "@/lib/copilot/knowledge";


export const GET = route(async (_req, { auth }) =>
  withTenant(auth.tenantId, async (tx) => {
    const docs = await tx.select().from(knowledgeDocs).where(eq(knowledgeDocs.tenantId, auth.tenantId)).orderBy(asc(knowledgeDocs.createdAt));
    const pipes = await tx.select({ id: pipelines.id, name: pipelines.name }).from(pipelines).where(eq(pipelines.tenantId, auth.tenantId)).orderBy(asc(pipelines.order));
    return { docs, categories: CATEGORIES, fullLimit: FULL_LIMIT, pipelines: pipes };
  }),
{ minRole: "MANAGER" });

export const POST = route(async (req, { auth }) => {
  const body = await parseBody(req, docSchema);
  return withTenant(auth.tenantId, async (tx) => {
    const [d] = await tx.insert(knowledgeDocs).values({ ...body, tenantId: auth.tenantId }).returning();
    return d;
  });
}, { minRole: "MANAGER" });
