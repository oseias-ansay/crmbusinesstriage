/** GET reunião com transcrição completa · DELETE apaga a reunião e o arquivo. */
import { rm } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db";
import { meetingRecords } from "@/db/schema";
import { notFound, route } from "@/lib/api";
import { UPLOAD_BASE } from "@/lib/meetings/process";

type P = { id: string };
const own = (t: string, id: string) => and(eq(meetingRecords.id, id), eq(meetingRecords.tenantId, t));

export const GET = route<P>(async (_req, { auth, params }) =>
  withTenant(auth.tenantId, async (tx) => {
    const [m] = await tx.select().from(meetingRecords).where(own(auth.tenantId, params.id)).limit(1);
    if (!m) notFound("Reunião");
    const { filePath, ...rest } = m;
    return { ...rest, hasFile: !!filePath };
  }),
);

export const DELETE = route<P>(async (_req, { auth, params }) =>
  withTenant(auth.tenantId, async (tx) => {
    const [m] = await tx.delete(meetingRecords).where(own(auth.tenantId, params.id)).returning();
    if (!m) notFound("Reunião");
    if (m.filePath) await rm(path.join(UPLOAD_BASE(), m.filePath), { force: true });
    return { ok: true };
  }),
);
