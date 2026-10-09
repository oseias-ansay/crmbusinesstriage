import { eq } from "drizzle-orm";
import { withTenant } from "@/db";
import { tasks } from "@/db/schema";
import { notFound, parseBody, route } from "@/lib/api";
import { taskSchema } from "@/lib/validators";
import { logActivity } from "@/lib/activity";
import { emitToTenant } from "@/lib/realtime";
import { z } from "zod";
import { deleteEvent, patchEventTime } from "@/lib/google/calendar";

const schema = taskSchema.partial().extend({ status: z.enum(["PENDING", "DONE", "CANCELED"]).optional() });

export const PATCH = route<{ id: string }>(async (req, { auth, params }) => {
  const body = await parseBody(req, schema);
  const task = await withTenant(auth.tenantId, async (tx) => {
    const [t] = await tx
      .update(tasks)
      .set({ ...body, ...(body.status === "DONE" && { completedAt: new Date() }), ...(body.dueDate && { remindedAt: null }) })
      .where(eq(tasks.id, params.id))
      .returning();
    if (!t) notFound("Tarefa");
    if (body.status === "DONE") await logActivity(tx, { tenantId: auth.tenantId, type: "TASK_DONE", summary: `Concluída: ${t.title}`, dealId: t.dealId, contactId: t.contactId, userId: auth.userId });
    return t;
  });
  emitToTenant(auth.tenantId, "task:updated", task);
  // Reunião ligada ao Google Agenda: cancelar remove o evento; mudar o horário atualiza
  if (task.externalRef) {
    if (body.status === "CANCELED") deleteEvent(auth.tenantId, task.externalRef);
    else if (body.dueDate) patchEventTime(auth.tenantId, task.externalRef, task.dueDate, task.durationMin ?? 30);
  }
  return task;
});

export const DELETE = route<{ id: string }>(async (_req, { auth, params }) => {
  const [t] = await withTenant(auth.tenantId, (tx) => tx.delete(tasks).where(eq(tasks.id, params.id)).returning({ ref: tasks.externalRef }));
  if (t?.ref) deleteEvent(auth.tenantId, t.ref);
  return { ok: true };
});
