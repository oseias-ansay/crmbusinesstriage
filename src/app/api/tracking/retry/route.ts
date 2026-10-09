/** POST — devolve à fila os eventos que falharam (ex.: depois de corrigir o token). */
import { eq } from "drizzle-orm";
import { withTenant } from "@/db";
import { conversionEvents } from "@/db/schema";
import { route } from "@/lib/api";

export const POST = route(async (_req, { auth }) =>
  withTenant(auth.tenantId, async (tx) => {
    const r = await tx.update(conversionEvents).set({ status: "PENDING", attempts: 0 }).where(eq(conversionEvents.status, "FAILED")).returning({ id: conversionEvents.id });
    return { requeued: r.length };
  }),
{ minRole: "ADMIN" });
