/**
 * Worker em processo (iniciado no server.ts):
 *  - executa ações agendadas (delayMinutes) da fila scheduled_jobs
 *  - envia lembretes de tarefas próximas/vencidas (sistema + e-mail)
 *
 * Usa FOR UPDATE SKIP LOCKED → seguro mesmo com várias instâncias.
 * Em escala maior, troque por BullMQ + Redis.
 */
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { withAdmin } from "@/db";
import { scheduledJobs, tasks, users, tenants, type AutomationAction } from "@/db/schema";
import { executeAction, fireTrigger, type TriggerContext } from "./engine";
import { notify } from "@/lib/activity";
import { sendEmail } from "@/lib/channels/email";
import { withTenant, type Tx } from "@/db";
import { conversations, liveRegistrations } from "@/db/schema";
import { sendOutbound } from "@/lib/services/messages";
import { processConversions } from "@/lib/meta/capi";
import { runAiClassify } from "@/lib/journey/ai";
import { sendStageMessage } from "@/lib/journey/hooks";

type ContactMessage = { contactId: string; text: string; requireTaskId?: string; requireLiveRegistrationId?: string };

/** Lembrete ao contato pelo WhatsApp (só se a reunião/inscrição ainda existir). */
async function sendContactMessage(tx: Tx, tenantId: string, p: ContactMessage) {
  if (p.requireTaskId) {
    const [t] = await tx.select({ s: tasks.status }).from(tasks).where(eq(tasks.id, p.requireTaskId)).limit(1);
    if (!t || t.s !== "PENDING") return;
  }
  if (p.requireLiveRegistrationId) {
    const [r] = await tx.select({ id: liveRegistrations.id }).from(liveRegistrations).where(eq(liveRegistrations.id, p.requireLiveRegistrationId)).limit(1);
    if (!r) return;
  }
  const [conv] = await tx
    .select()
    .from(conversations)
    .where(and(eq(conversations.contactId, p.contactId), eq(conversations.channel, "WHATSAPP")))
    .limit(1);
  if (!conv) return;
  await sendOutbound(tx, { tenantId, conversationId: conv.id, senderType: "BOT", content: p.text });
}

export async function processScheduledJobs(batch = 20) {
  const jobs = await withAdmin(async (tx) => {
    const rows = await tx
      .select()
      .from(scheduledJobs)
      .where(and(isNull(scheduledJobs.doneAt), lte(scheduledJobs.runAt, new Date()), sql`${scheduledJobs.attempts} < 5`))
      .orderBy(scheduledJobs.runAt)
      .limit(batch)
      .for("update", { skipLocked: true });
    for (const j of rows) {
      await tx.update(scheduledJobs).set({ attempts: j.attempts + 1, doneAt: new Date() }).where(eq(scheduledJobs.id, j.id));
    }
    return rows;
  });

  for (const job of jobs) {
    try {
      if (job.kind === "STAGE_MESSAGE") {
        const p = job.payload as { dealId: string; stageId: string };
        await withTenant(job.tenantId, (tx) => sendStageMessage(tx, job.tenantId, p.dealId, p.stageId));
        continue;
      }
      if (job.kind === "CONTACT_MESSAGE") {
        await withTenant(job.tenantId, (tx) => sendContactMessage(tx, job.tenantId, job.payload as ContactMessage));
        continue;
      }
      if (job.kind === "AI_CLASSIFY") {
        const p = job.payload as { dealId: string };
        const out = await runAiClassify(job.tenantId, p.dealId);
        await withAdmin((tx) => tx.update(scheduledJobs).set({ lastError: JSON.stringify(out).slice(0, 500) }).where(eq(scheduledJobs.id, job.id)));
        continue;
      }
      const p = job.payload as { automationId: string; action: AutomationAction; ctx: TriggerContext };
      await executeAction(job.tenantId, p.automationId, { ...p.action, delayMinutes: 0 }, p.ctx);
    } catch (e) {
      await withAdmin((tx) => tx.update(scheduledJobs).set({ doneAt: null, lastError: String(e) }).where(eq(scheduledJobs.id, job.id)));
    }
  }
  return jobs.length;
}

/** Lembretes: tarefas que vencem nos próximos 30 min ou já venceram, ainda não lembradas. */
export async function processTaskReminders() {
  const soon = new Date(Date.now() + 30 * 60_000);
  const due = await withAdmin(async (tx) => {
    const rows = await tx
      .select({ task: tasks, user: users, tenant: tenants })
      .from(tasks)
      .innerJoin(users, eq(users.id, tasks.userId))
      .innerJoin(tenants, eq(tenants.id, tasks.tenantId))
      .where(and(eq(tasks.status, "PENDING"), isNull(tasks.remindedAt), lte(tasks.dueDate, soon)))
      .limit(100);
    for (const r of rows) {
      await tx.update(tasks).set({ remindedAt: new Date() }).where(eq(tasks.id, r.task.id));
      const overdue = r.task.dueDate < new Date();
      await notify(tx, {
        tenantId: r.task.tenantId,
        userId: r.user.id,
        title: overdue ? "Tarefa vencida" : "Tarefa em 30 minutos",
        body: r.task.title,
        link: "/tasks",
      });
    }
    return rows;
  });

  for (const r of due) {
    const overdue = r.task.dueDate < new Date();
    if (overdue) fireTrigger(r.task.tenantId, "TASK_OVERDUE", { dealId: r.task.dealId ?? undefined, contactId: r.task.contactId ?? undefined });
    sendEmail({
      to: r.user.email,
      subject: `${overdue ? "⚠ Tarefa vencida" : "⏰ Lembrete"}: ${r.task.title}`,
      html: `<p>Olá ${r.user.name},</p><p>${overdue ? "Esta tarefa está vencida" : "Esta tarefa vence em breve"}: <b>${r.task.title}</b></p><p>Prazo: ${r.task.dueDate.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p>`,
      settings: r.tenant.settings,
    }).catch((e) => console.error("[reminder-email]", e));
  }
  return due.length;
}

let started = false;
export function startWorker() {
  if (started) return;
  started = true;
  const tick = async () => {
    try {
      await processScheduledJobs();
      await processTaskReminders();
      await processConversions();
    } catch (e) {
      console.error("[worker]", e);
    }
  };
  setInterval(tick, 60_000);
  setTimeout(tick, 5_000);
  console.log("⚙ Worker de automações/lembretes iniciado");
}
