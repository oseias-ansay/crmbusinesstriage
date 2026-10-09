/** GET lives (próximas e passadas, com nº de inscritos) · POST nova live. */
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db";
import { liveEvents, liveRegistrations } from "@/db/schema";
import { parseBody, route } from "@/lib/api";

const liveSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(1000).optional().nullable(),
  startsAt: z.coerce.date(),
  durationMin: z.coerce.number().int().min(10).max(600).default(60),
  link: z.string().trim().url("Link inválido").optional().nullable().or(z.literal("").transform(() => null)),
  isActive: z.boolean().default(true),
});

export const GET = route(async (_req, { auth }) =>
  withTenant(auth.tenantId, (tx) =>
    tx
      .select({
        id: liveEvents.id, title: liveEvents.title, description: liveEvents.description, startsAt: liveEvents.startsAt,
        durationMin: liveEvents.durationMin, link: liveEvents.link, isActive: liveEvents.isActive,
        inscritos: sql<number>`(select count(*)::int from ${liveRegistrations} where ${liveRegistrations.liveId} = ${liveEvents.id})`,
      })
      .from(liveEvents)
      .where(eq(liveEvents.tenantId, auth.tenantId))
      .orderBy(desc(liveEvents.startsAt))
      .limit(100),
  ),
);

export const POST = route(async (req, { auth }) => {
  const body = await parseBody(req, liveSchema);
  return withTenant(auth.tenantId, async (tx) => (await tx.insert(liveEvents).values({ ...body, tenantId: auth.tenantId }).returning())[0]);
}, { minRole: "MANAGER" });
