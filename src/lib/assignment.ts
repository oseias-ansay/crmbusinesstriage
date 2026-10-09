/** Distribuição automática (round-robin) entre usuários que recebem leads. */
import { and, asc, eq, sql } from "drizzle-orm";
import { users } from "@/db/schema";
import type { Tx } from "@/db";

export async function pickNextAgent(tx: Tx, tenantId: string): Promise<string | null> {
  // Quem recebeu lead há mais tempo (ou nunca) é o próximo
  const [next] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true), eq(users.receivesLeads, true)))
    .orderBy(sql`${users.lastAssignedAt} asc nulls first`, asc(users.createdAt))
    .limit(1)
    .for("update", { skipLocked: true });
  if (!next) return null;
  await tx.update(users).set({ lastAssignedAt: new Date() }).where(eq(users.id, next.id));
  return next.id;
}
