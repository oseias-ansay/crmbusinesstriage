/**
 * ════════════════════════════════════════════════════════════════════
 *  Motor de Automação (Digital Pipeline)
 * ════════════════════════════════════════════════════════════════════
 *  fireTrigger() é chamado DEPOIS do commit da transação principal
 *  (ex.: após mover um card). Ele roda em segundo plano, numa transação
 *  própria, para não atrasar a resposta da API nem segurar locks
 *  enquanto chama APIs externas (WhatsApp, e-mail, webhooks).
 *
 *  Ações com `delayMinutes` > 0 vão para a tabela scheduled_jobs e são
 *  executadas pelo worker (src/lib/automation/worker.ts).
 *
 *  Proteção contra loop: MOVE_STAGE dispara DEAL_STAGE_CHANGED de novo;
 *  limitamos a profundidade em MAX_DEPTH.
 */
import { and, eq, sql } from "drizzle-orm";
import { withTenant, type Tx } from "@/db";
import {
  automationLogs,
  automations,
  contacts,
  contactTags,
  conversations,
  dealTags,
  deals,
  scheduledJobs,
  tasks,
  tenants,
  users,
  type AutomationAction,
  type AutomationConditions,
} from "@/db/schema";
import { renderTemplate } from "@/lib/utils";
import { pickNextAgent } from "@/lib/assignment";
import { ensureTags, moveDeal } from "@/lib/services/deals";
import { sendOutbound } from "@/lib/services/messages";
import { sendEmail } from "@/lib/channels/email";
import { logActivity, notify } from "@/lib/activity";
import { emitToTenant } from "@/lib/realtime";
import { runJourneyHooks } from "@/lib/journey/hooks";

export type TriggerType = (typeof automations.$inferSelect)["triggerType"];

export type TriggerContext = {
  dealId?: string;
  contactId?: string;
  stageId?: string; // etapa de destino
  pipelineId?: string;
  tagName?: string;
  formId?: string;
  value?: number;
  depth?: number;
};

const MAX_DEPTH = 3;

/** Dispara (fire-and-forget) todas as automações ativas que casam com o gatilho. */
export function fireTrigger(tenantId: string, trigger: TriggerType, ctx: TriggerContext) {
  if ((ctx.depth ?? 0) >= MAX_DEPTH) return;
  setImmediate(() => {
    runTrigger(tenantId, trigger, ctx).catch((e) => console.error("[automation]", trigger, e));
  });
}

export async function runTrigger(tenantId: string, trigger: TriggerType, ctx: TriggerContext) {
  // Jornada fixa: mensagem da etapa, eventos Meta, ficha de cliente, IA.
  await runJourneyHooks(tenantId, trigger, ctx).catch((e) => console.error("[journey]", trigger, e));
  const list = await withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(automations)
      .where(and(eq(automations.tenantId, tenantId), eq(automations.triggerType, trigger), eq(automations.isActive, true))),
  );

  for (const automation of list) {
    if (!matches(automation.conditions, ctx)) continue;
    for (const action of automation.actionsJson) {
      if (action.delayMinutes && action.delayMinutes > 0) {
        await withTenant(tenantId, (tx) =>
          tx.insert(scheduledJobs).values({
            tenantId,
            kind: "AUTOMATION_ACTION",
            payload: { automationId: automation.id, action, ctx },
            runAt: new Date(Date.now() + action.delayMinutes! * 60_000),
          }),
        );
        continue;
      }
      await executeAction(tenantId, automation.id, action, ctx);
    }
    await withTenant(tenantId, (tx) =>
      tx.update(automations).set({ runCount: sql`${automations.runCount} + 1` }).where(eq(automations.id, automation.id)),
    );
  }
}

function matches(c: AutomationConditions, ctx: TriggerContext) {
  if (c.pipelineId && c.pipelineId !== ctx.pipelineId) return false;
  if (c.stageId && c.stageId !== ctx.stageId) return false;
  if (c.tagName && c.tagName.toLowerCase() !== ctx.tagName?.toLowerCase()) return false;
  if (c.formId && c.formId !== ctx.formId) return false;
  if (c.minValue != null && (ctx.value ?? 0) < c.minValue) return false;
  return true;
}

/** Executa UMA ação e registra o log (sucesso/erro). */
export async function executeAction(tenantId: string, automationId: string, action: AutomationAction, ctx: TriggerContext) {
  try {
    const detail = await withTenant(tenantId, async (tx) => {
      const vars = await loadVars(tx, tenantId, ctx);
      const out = await perform(tx, tenantId, action, ctx, vars);
      if (ctx.dealId) {
        await logActivity(tx, { tenantId, type: "AUTOMATION", summary: `Automação: ${action.type}`, dealId: ctx.dealId, contactId: vars.contact?.id ?? null });
      }
      return out;
    });
    await withTenant(tenantId, (tx) =>
      tx.insert(automationLogs).values({ tenantId, automationId, dealId: ctx.dealId, status: "SUCCESS", detail: { action: action.type, ...detail } }),
    );
  } catch (e) {
    await withTenant(tenantId, (tx) =>
      tx.insert(automationLogs).values({ tenantId, automationId, dealId: ctx.dealId, status: "ERROR", detail: { action: action.type, error: String(e) } }),
    );
  }
}

async function loadVars(tx: Tx, tenantId: string, ctx: TriggerContext) {
  const [deal] = ctx.dealId ? await tx.select().from(deals).where(eq(deals.id, ctx.dealId)).limit(1) : [];
  const contactId = ctx.contactId ?? deal?.contactId;
  const [c] = contactId ? await tx.select().from(contacts).where(eq(contacts.id, contactId)).limit(1) : [];
  const first = c?.name.split(/\s+/)[0] ?? "";
  const contact = c ? { ...c, firstName: /^\d+$/.test(first) ? "" : first } : undefined;
  const [user] = deal?.userId ? await tx.select().from(users).where(eq(users.id, deal.userId)).limit(1) : [];
  const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return { deal, contact, user, tenant };
}

async function perform(
  tx: Tx,
  tenantId: string,
  action: AutomationAction,
  ctx: TriggerContext,
  v: Awaited<ReturnType<typeof loadVars>>,
): Promise<Record<string, unknown>> {
  const r = (s: string) => renderTemplate(s, v as Record<string, unknown>);

  switch (action.type) {
    case "SEND_WHATSAPP": {
      if (!v.contact?.phone) return { skipped: "contato sem telefone" };
      // Reaproveita a conversa de WhatsApp do contato, ou cria uma
      let [conv] = await tx
        .select()
        .from(conversations)
        .where(and(eq(conversations.contactId, v.contact.id), eq(conversations.channel, "WHATSAPP")))
        .limit(1);
      if (!conv) {
        [conv] = await tx
          .insert(conversations)
          .values({ tenantId, contactId: v.contact.id, dealId: v.deal?.id, channel: "WHATSAPP" })
          .returning();
      }
      await sendOutbound(tx, { tenantId, conversationId: conv.id, senderType: "BOT", content: r(action.params.text) });
      return { conversationId: conv.id };
    }
    case "SEND_EMAIL": {
      if (!v.contact?.email) return { skipped: "contato sem e-mail" };
      await sendEmail({ to: v.contact.email, subject: r(action.params.subject), html: r(action.params.body), settings: v.tenant.settings });
      return { to: v.contact.email };
    }
    case "CREATE_TASK": {
      const userId = v.deal?.userId ?? v.contact?.ownerId;
      if (!userId) return { skipped: "sem responsável" };
      const [task] = await tx
        .insert(tasks)
        .values({
          tenantId,
          userId,
          dealId: v.deal?.id,
          contactId: v.contact?.id,
          title: r(action.params.title),
          type: (action.params.taskType as "CALL") ?? "OTHER",
          dueDate: new Date(Date.now() + (action.params.dueInHours ?? 24) * 3_600_000),
        })
        .returning();
      await notify(tx, { tenantId, userId, title: "Nova tarefa (automação)", body: task.title, link: "/tasks" });
      return { taskId: task.id };
    }
    case "ASSIGN_USER": {
      if (!v.deal) return { skipped: "sem negócio" };
      const userId = action.params.userId ?? (await pickNextAgent(tx, tenantId));
      if (!userId) return { skipped: "sem usuários disponíveis" };
      await tx.update(deals).set({ userId }).where(eq(deals.id, v.deal.id));
      await tx.update(conversations).set({ assignedToId: userId }).where(eq(conversations.dealId, v.deal.id));
      await notify(tx, { tenantId, userId, title: "Novo lead atribuído a você", body: v.deal.title, link: `/pipeline?deal=${v.deal.id}` });
      emitToTenant(tenantId, "deal:updated", { id: v.deal.id, userId });
      return { userId };
    }
    case "ADD_TAG": {
      const [tag] = await ensureTags(tx, tenantId, [r(action.params.tag)]);
      if (v.deal) await tx.insert(dealTags).values({ tenantId, dealId: v.deal.id, tagId: tag.id }).onConflictDoNothing();
      if (v.contact) await tx.insert(contactTags).values({ tenantId, contactId: v.contact.id, tagId: tag.id }).onConflictDoNothing();
      return { tag: tag.name };
    }
    case "MOVE_STAGE": {
      if (!v.deal) return { skipped: "sem negócio" };
      const res = await moveDeal(tx, tenantId, null, v.deal.id, action.params.stageId);
      emitToTenant(tenantId, "deal:moved", res.deal);
      if (res.stageChanged) {
        fireTrigger(tenantId, "DEAL_STAGE_CHANGED", { dealId: v.deal.id, stageId: action.params.stageId, pipelineId: res.deal.pipelineId, depth: (ctx.depth ?? 0) + 1 });
      }
      return { stageId: action.params.stageId };
    }
    case "WEBHOOK": {
      const res = await fetch(action.params.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: ctx, deal: v.deal, contact: v.contact }),
      });
      return { status: res.status };
    }
  }
}
