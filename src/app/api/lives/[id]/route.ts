/** GET inscritos · PATCH edita · DELETE remove a live. */
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db";
import { contacts, liveEvents, liveRegistrations } from "@/db/schema";
import { notFound, parseBody, route } from "@/lib/api";

type P = { id: string };
const schema = z.object({
  title: z.string().trim().min(3).max(160).optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  startsAt: z.coerce.date().optional(),
  durationMin: z.coerce.number().int().min(10).max(600).optional(),
  link: z.string().trim().url("Link inválido").optional().nullable().or(z.literal("").transform(() => null)),
  isActive: z.boolean().optional(),
});

export const GET = route<P>(async (_req, { auth, params }) =>
  withTenant(auth.tenantId, (tx) =>
    tx
      .select({ id: liveRegistrations.id, createdAt: liveRegistrations.createdAt, contactId: contacts.id, name: contacts.name, phone: contacts.phone, email: contacts.email })
      .from(liveRegistrations)
      .innerJoin(contacts, eq(contacts.id, liveRegistrations.contactId))
      .where(eq(liveRegistrations.liveId, params.id))
      .orderBy(asc(liveRegistrations.createdAt)),
  ),
);

export const PATCH = route<P>(async (req, { auth, params }) => {
  const body = await parseBody(req, schema);
  return withTenant(auth.tenantId, async (tx) => {
    const [l] = await tx.update(liveEvents).set(body).where(eq(liveEvents.id, params.id)).returning();
    return l ?? notFound("Live");
  });
}, { minRole: "MANAGER" });

export const DELETE = route<P>(async (_req, { auth, params }) => {
  await withTenant(auth.tenantId, (tx) => tx.delete(liveEvents).where(eq(liveEvents.id, params.id)));
  return { ok: true };
}, { minRole: "MANAGER" });
