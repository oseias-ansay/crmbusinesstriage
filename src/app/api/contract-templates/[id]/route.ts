/** PATCH { name?, body?, isDefault? } · DELETE (mantém os contratos já gerados). */
import { count, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db";
import { contractTemplates } from "@/db/schema";
import { ApiError, notFound, parseBody, route } from "@/lib/api";

const schema = z.object({ name: z.string().trim().min(2).max(120).optional(), body: z.string().min(20).max(100_000).optional(), isDefault: z.boolean().optional() });

export const PATCH = route<{ id: string }>(async (req, { auth, params }) => {
  const body = await parseBody(req, schema);
  return withTenant(auth.tenantId, async (tx) => {
    if (body.isDefault) await tx.update(contractTemplates).set({ isDefault: false }).where(ne(contractTemplates.id, params.id));
    const [t] = await tx.update(contractTemplates).set(body).where(eq(contractTemplates.id, params.id)).returning();
    return t ?? notFound("Modelo");
  });
}, { minRole: "ADMIN" });

export const DELETE = route<{ id: string }>(async (_req, { auth, params }) => {
  await withTenant(auth.tenantId, async (tx) => {
    const [{ n }] = await tx.select({ n: count() }).from(contractTemplates).where(ne(contractTemplates.id, params.id));
    if (n === 0) throw new ApiError(409, "Mantenha pelo menos um modelo");
    await tx.delete(contractTemplates).where(eq(contractTemplates.id, params.id));
  });
  return { ok: true };
}, { minRole: "ADMIN" });
