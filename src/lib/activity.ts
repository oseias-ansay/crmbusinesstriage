/** Registro da linha do tempo (visão 360°) e notificações internas. */
import { activities, notifications } from "@/db/schema";
import type { Tx } from "@/db";
import { emitToUser } from "./realtime";

type ActivityType = (typeof activities.$inferInsert)["type"];

export async function logActivity(
  tx: Tx,
  a: { tenantId: string; type: ActivityType; summary: string; dealId?: string | null; contactId?: string | null; userId?: string | null; meta?: unknown },
) {
  await tx.insert(activities).values({ ...a, meta: a.meta ?? null });
}

export async function notify(tx: Tx, n: { tenantId: string; userId: string; title: string; body?: string; link?: string }) {
  const [row] = await tx.insert(notifications).values(n).returning();
  emitToUser(n.userId, "notification:new", row);
  return row;
}
