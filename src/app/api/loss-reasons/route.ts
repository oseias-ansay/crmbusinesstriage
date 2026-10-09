import { asc, eq } from "drizzle-orm";
import { withTenant } from "@/db";
import { lossReasons } from "@/db/schema";
import { route } from "@/lib/api";

export const GET = route(async (_req, { auth }) =>
  withTenant(auth.tenantId, (tx) => tx.select().from(lossReasons).where(eq(lossReasons.tenantId, auth.tenantId)).orderBy(asc(lossReasons.name))),
);
