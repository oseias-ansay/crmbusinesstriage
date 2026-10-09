/** GET modelos (cria o modelo padrão na 1ª vez) · POST novo modelo. */
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db";
import { contractTemplates } from "@/db/schema";
import { parseBody, route } from "@/lib/api";
import { ensureDefaultTemplate } from "@/lib/services/clients";
import { VARIAVEIS } from "@/lib/contracts/render";

export const GET = route(async (_req, { auth }) =>
  withTenant(auth.tenantId, async (tx) => {
    await ensureDefaultTemplate(tx, auth.tenantId);
    const list = await tx.select().from(contractTemplates).where(eq(contractTemplates.tenantId, auth.tenantId)).orderBy(asc(contractTemplates.createdAt));
    return { templates: list, variaveis: VARIAVEIS };
  }),
);

const schema = z.object({ name: z.string().trim().min(2).max(120), body: z.string().min(20).max(100_000) });

export const POST = route(async (req, { auth }) => {
  const body = await parseBody(req, schema);
  return withTenant(auth.tenantId, async (tx) => {
    const [t] = await tx.insert(contractTemplates).values({ ...body, tenantId: auth.tenantId }).returning();
    return t;
  });
}, { minRole: "ADMIN" });
