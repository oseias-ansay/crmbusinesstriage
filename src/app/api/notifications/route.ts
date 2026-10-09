import { and, desc, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db";
import { notifications } from "@/db/schema";
import { route } from "@/lib/api";

export const GET = route(async (_req, { auth }) =>
  withTenant(auth.tenantId, (tx) => tx.select().from(notifications).where(eq(notifications.userId, auth.userId)).orderBy(desc(notifications.createdAt)).limit(30)),
);

/** PATCH marca todas como lidas */
export const PATCH = route(async (_req, { auth }) => {
  await withTenant(auth.tenantId, (tx) =>
    tx.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, auth.userId), isNull(notifications.readAt))),
  );
  return { ok: true };
});
