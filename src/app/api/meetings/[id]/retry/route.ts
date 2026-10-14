/** POST → reprocessa (refaz a análise; transcreve de novo só se a transcrição não existir). */
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db";
import { meetingRecords } from "@/db/schema";
import { notFound, route } from "@/lib/api";
import { processMeetingInBackground } from "@/lib/meetings/process";

export const POST = route<{ id: string }>(async (_req, { auth, params }) => {
  const [m] = await withTenant(auth.tenantId, (tx) =>
    tx.update(meetingRecords).set({ status: "PENDING", error: null, updatedAt: new Date() }).where(and(eq(meetingRecords.id, params.id), eq(meetingRecords.tenantId, auth.tenantId))).returning({ id: meetingRecords.id }),
  );
  if (!m) notFound("Reunião");
  processMeetingInBackground(auth.tenantId, m.id);
  return { ok: true };
});
