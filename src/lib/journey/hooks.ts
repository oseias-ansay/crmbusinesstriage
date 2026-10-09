/**
 * ════════════════════════════════════════════════════════════════════
 *  Ganchos fixos da jornada (rodam antes das automações do usuário)
 * ════════════════════════════════════════════════════════════════════
 *  - Ao ENTRAR numa etapa: mensagem automática de WhatsApp da etapa
 *    (com atraso opcional) e evento da Meta configurado na etapa.
 *  - Lead criado: evento "Lead" para a Meta.
 *  - Negócio ganho: evento "Purchase" (valor do negócio) e ficha de cliente.
 *  - Mensagem recebida: agenda a análise da IA (se ligada no funil).
 */
import { and, eq, sql } from "drizzle-orm";
import { withTenant, type Tx } from "@/db";
import { activities, contacts, conversations, deals, scheduledJobs, stages, tenants, users } from "@/db/schema";
import { renderTemplate } from "@/lib/utils";
import { sendOutbound } from "@/lib/services/messages";
import { logActivity } from "@/lib/activity";
import { queueConversion } from "@/lib/meta/capi";
import { scheduleAiClassify } from "./ai";
import { ensureClientFromDeal } from "@/lib/services/clients";

type Ctx = { dealId?: string; contactId?: string; stageId?: string };

export async function runJourneyHooks(tenantId: string, trigger: string, ctx: Ctx) {
  if (!ctx.dealId && trigger !== "MESSAGE_RECEIVED") return;
  switch (trigger) {
    case "DEAL_CREATED": {
      await withTenant(tenantId, async (tx) => {
        await queueConversion(tx, tenantId, { dealId: ctx.dealId!, eventName: "Lead" });
        const [d] = await tx.select({ stageId: deals.stageId }).from(deals).where(eq(deals.id, ctx.dealId!)).limit(1);
        if (d) await onStageEntered(tx, tenantId, ctx.dealId!, d.stageId);
      });
      break;
    }
    case "DEAL_STAGE_CHANGED": {
      if (!ctx.stageId) break;
      await withTenant(tenantId, (tx) => onStageEntered(tx, tenantId, ctx.dealId!, ctx.stageId!));
      break;
    }
    case "DEAL_WON": {
      await withTenant(tenantId, async (tx) => {
        await queueConversion(tx, tenantId, { dealId: ctx.dealId!, eventName: "Purchase" });
        await ensureClientFromDeal(tx, tenantId, ctx.dealId!);
      });
      break;
    }
    case "MESSAGE_RECEIVED": {
      if (ctx.dealId) await withTenant(tenantId, (tx) => scheduleAiClassify(tx, tenantId, ctx.dealId!));
      break;
    }
  }
}

async function onStageEntered(tx: Tx, tenantId: string, dealId: string, stageId: string) {
  const [stage] = await tx.select().from(stages).where(eq(stages.id, stageId)).limit(1);
  if (!stage) return;
  if (stage.metaEvent) await queueConversion(tx, tenantId, { dealId, eventName: stage.metaEvent });
  if (stage.autoMessage?.trim()) {
    if (stage.autoMessageDelayMin > 0) {
      await tx.insert(scheduledJobs).values({
        tenantId,
        kind: "STAGE_MESSAGE",
        payload: { dealId, stageId },
        runAt: new Date(Date.now() + stage.autoMessageDelayMin * 60_000),
      });
    } else {
      await sendStageMessage(tx, tenantId, dealId, stageId);
    }
  }
}

/**
 * Envia a mensagem da etapa, se o card AINDA estiver nela (no caso de atraso)
 * e se ela ainda não foi enviada para este negócio (card que volta e avança
 * de novo não manda a mesma mensagem duas vezes).
 */
export async function sendStageMessage(tx: Tx, tenantId: string, dealId: string, stageId: string) {
  const [row] = await tx
    .select({ deal: deals, stage: stages, contact: contacts, tenant: tenants })
    .from(deals)
    .innerJoin(stages, eq(stages.id, deals.stageId))
    .innerJoin(tenants, eq(tenants.id, deals.tenantId))
    .leftJoin(contacts, eq(contacts.id, deals.contactId))
    .where(eq(deals.id, dealId))
    .limit(1);
  if (!row || row.deal.stageId !== stageId) return { skipped: "card já saiu da etapa" };
  if (!row.stage.autoMessage?.trim()) return { skipped: "etapa sem mensagem" };
  if (!row.contact?.phone) return { skipped: "contato sem telefone" };

  const [already] = await tx
    .select({ id: activities.id })
    .from(activities)
    .where(and(eq(activities.dealId, dealId), sql`${activities.meta}->>'stageMessage' = ${stageId}`))
    .limit(1);
  if (already) return { skipped: "mensagem desta etapa já enviada" };

  const [user] = row.deal.userId ? await tx.select().from(users).where(eq(users.id, row.deal.userId)).limit(1) : [];
  const firstName = row.contact.name.split(/\s+/)[0];
  const text = renderTemplate(row.stage.autoMessage, {
    contact: { ...row.contact, firstName: /^\d+$/.test(firstName) ? "" : firstName },
    deal: row.deal,
    user: user ?? {},
    tenant: row.tenant,
    stage: row.stage,
  }).trim();
  if (!text) return { skipped: "mensagem vazia" };

  let [conv] = await tx
    .select()
    .from(conversations)
    .where(and(eq(conversations.contactId, row.contact.id), eq(conversations.channel, "WHATSAPP")))
    .limit(1);
  if (!conv) {
    [conv] = await tx.insert(conversations).values({ tenantId, contactId: row.contact.id, dealId, channel: "WHATSAPP" }).returning();
  }
  await sendOutbound(tx, { tenantId, conversationId: conv.id, senderType: "BOT", content: text });
  await logActivity(tx, { tenantId, type: "AUTOMATION", summary: `Mensagem automática da etapa "${row.stage.name}"`, dealId, contactId: row.contact.id, meta: { stageMessage: stageId } });
  return { sent: true };
}
