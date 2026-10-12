/** PATCH edita · DELETE exclui um documento da base de conhecimento. */
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db";
import { knowledgeDocs } from "@/db/schema";
import { notFound, parseBody, route } from "@/lib/api";
import { docSchema } from "@/lib/copilot/knowledge";

type P = { id: string };
const own = (tenantId: string, id: string) => and(eq(knowledgeDocs.id, id), eq(knowledgeDocs.tenantId, tenantId));

export const PATCH = route<P>(async (req, { auth, params }) => {
  const body = await parseBody(req, docSchema.partial());
  return withTenant(auth.tenantId, async (tx) => {
    const [d] = await tx.update(knowledgeDocs).set({ ...body, updatedAt: new Date() }).where(own(auth.tenantId, params.id)).returning();
    return d ?? notFound("Documento");
  });
}, { minRole: "MANAGER" });

export const DELETE = route<P>(async (_req, { auth, params }) =>
  withTenant(auth.tenantId, async (tx) => {
    const [d] = await tx.delete(knowledgeDocs).where(own(auth.tenantId, params.id)).returning({ id: knowledgeDocs.id });
    return d ?? notFound("Documento");
  }),
{ minRole: "MANAGER" });
