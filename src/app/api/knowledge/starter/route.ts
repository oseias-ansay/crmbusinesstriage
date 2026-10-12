/** POST → cria documentos-modelo (roteiro para preencher) se a base estiver vazia. */
import { eq } from "drizzle-orm";
import { withTenant } from "@/db";
import { knowledgeDocs } from "@/db/schema";
import { ApiError, route } from "@/lib/api";
import { STARTER_DOCS } from "@/lib/copilot/starter";

export const POST = route(async (_req, { auth }) =>
  withTenant(auth.tenantId, async (tx) => {
    const has = await tx.select({ id: knowledgeDocs.id }).from(knowledgeDocs).where(eq(knowledgeDocs.tenantId, auth.tenantId)).limit(1);
    if (has.length) throw new ApiError(409, "A base já tem documentos.");
    return tx.insert(knowledgeDocs).values(STARTER_DOCS.map((d) => ({ ...d, tenantId: auth.tenantId, isActive: false }))).returning();
  }),
{ minRole: "MANAGER" });
