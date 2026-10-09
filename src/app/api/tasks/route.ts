/** GET /api/tasks?from=&to=&userId=&status= (lista e calendário) · POST cria tarefa */
import { and, asc, eq, gte, lte, type SQL } from "drizzle-orm";
import { withTenant } from "@/db";
import { contacts, deals, tasks, users } from "@/db/schema";
import { parseBody, route } from "@/lib/api";
import { taskSchema } from "@/lib/validators";
import { logActivity, notify } from "@/lib/activity";
import { emitToTenant } from "@/lib/realtime";

export const GET = route(async (req, { auth }) => {
  const sp = new URL(req.url).searchParams;
  const f: SQL[] = [eq(tasks.tenantId, auth.tenantId)];
  if (sp.get("from")) f.push(gte(tasks.dueDate, new Date(sp.get("from")!)));
  if (sp.get("to")) f.push(lte(tasks.dueDate, new Date(sp.get("to")!)));
  if (sp.get("status")) f.push(eq(tasks.status, sp.get("status") as "PENDING"));
  const userId = auth.role === "AGENT" ? auth.userId : sp.get("userId");
  if (userId) f.push(eq(tasks.userId, userId));

  return withTenant(auth.tenantId, (tx) =>
    tx
      .select({ task: tasks, userName: users.name, dealTitle: deals.title, contactName: contacts.name })
      .from(tasks)
      .innerJoin(users, eq(users.id, tasks.userId))
      .leftJoin(deals, eq(deals.id, tasks.dealId))
      .leftJoin(contacts, eq(contacts.id, tasks.contactId))
      .where(and(...f))
      .orderBy(asc(tasks.dueDate))
      .limit(1000),
  ).then((rows) => rows.map((r) => ({ ...r.task, userName: r.userName, dealTitle: r.dealTitle, contactName: r.contactName })));
});

export const POST = route(async (req, { auth }) => {
  const body = await parseBody(req, taskSchema);
  const task = await withTenant(auth.tenantId, async (tx) => {
    const [t] = await tx.insert(tasks).values({ ...body, tenantId: auth.tenantId, userId: body.userId ?? auth.userId }).returning();
    await logActivity(tx, { tenantId: auth.tenantId, type: "TASK_CREATED", summary: `Tarefa: ${t.title}`, dealId: t.dealId, contactId: t.contactId, userId: auth.userId });
    if (t.userId !== auth.userId) await notify(tx, { tenantId: auth.tenantId, userId: t.userId, title: "Nova tarefa para você", body: t.title, link: "/tasks" });
    return t;
  });
  emitToTenant(auth.tenantId, "task:updated", task);
  return Response.json(task, { status: 201 });
});
