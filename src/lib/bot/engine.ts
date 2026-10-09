/**
 * Motor do robô de triagem/qualificação.
 * Recebe a resposta do contato, avança no grafo e devolve as mensagens a enviar.
 * O estado fica em conversations.botState → o bot "lembra" onde parou.
 */
import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { botFlows, contacts, conversations, dealTags, deals, tasks, type BotState, type Conversation } from "@/db/schema";
import { moveDeal } from "@/lib/services/deals";
import { queueConversion } from "@/lib/meta/capi";
import { logActivity, notify } from "@/lib/activity";
import { renderTemplate } from "@/lib/utils";
import { pickNextAgent } from "@/lib/assignment";
import { ensureTags } from "@/lib/services/deals";
import { contactTags } from "@/db/schema";
import { evaluateQualify, offHours, type BotFlowDef, type BotNode } from "./types";
import { answerLive, answerSlot, offerLives, offerSlots } from "./booking";

/** Gatilhos que o robô gerou; disparados pelo chamador DEPOIS do commit. */
export type BotTrigger = { type: "DEAL_STAGE_CHANGED"; ctx: { dealId: string; stageId: string; pipelineId: string } };

const MAX_STEPS = 25; // proteção contra loops no fluxo

export async function runBot(
  tx: Tx,
  conv: Conversation,
  incomingText: string,
): Promise<{ replies: string[]; handedOff: boolean; triggers: BotTrigger[] }> {
  const replies: string[] = [];
  const triggers: BotTrigger[] = [];
  // Para quando o fluxo terminou ou um humano assumiu a conversa (PATCH /conversations marca done)
  if (conv.botState?.done) return { replies, handedOff: false, triggers };

  let state: BotState | null = conv.botState ?? null;
  let flow: BotFlowDef | null = null;

  if (state) {
    const [f] = await tx.select().from(botFlows).where(eq(botFlows.id, state.flowId)).limit(1);
    flow = (f?.flow as BotFlowDef) ?? null;
  } else {
    const [f] = await tx
      .select()
      .from(botFlows)
      .where(and(eq(botFlows.tenantId, conv.tenantId), eq(botFlows.channel, conv.channel), eq(botFlows.isActive, true)))
      .limit(1);
    if (!f) return { replies, handedOff: false, triggers };
    // Lead já qualificado (ex.: veio do diagnóstico do site) não passa de novo pela triagem
    const [c0] = await tx.select({ cf: contacts.customFields }).from(contacts).where(eq(contacts.id, conv.contactId)).limit(1);
    if (c0?.cf && (c0.cf as Record<string, unknown>).qualificacao) return { replies, handedOff: false, triggers };
    flow = f.flow as BotFlowDef;
    state = { flowId: f.id, nodeId: flow.startNodeId, vars: {} };
    incomingText = ""; // primeira mensagem só inicia o fluxo
  }
  if (!flow) return { replies, handedOff: false, triggers };

  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  let node: BotNode | undefined = byId.get(state.nodeId);

  // Se estávamos aguardando resposta, grava a variável e avança
  if (node && (node.type === "question" || node.type === "choice") && incomingText) {
    let answer = incomingText.trim();
    if (node.type === "choice") {
      const idx = Number(answer) - 1;
      const match = node.data.options[idx] ?? node.data.options.find((o) => o.toLowerCase() === answer.toLowerCase());
      if (!match) {
        replies.push(`Por favor, responda com o número de uma opção:\n${node.data.options.map((o, i) => `${i + 1}. ${o}`).join("\n")}`);
        return { replies, handedOff: false, triggers };
      }
      answer = match;
    }
    state.vars[node.data.variable] = answer;
    node = node.next ? byId.get(node.next) : undefined;
  }

  let [contact] = await tx.select().from(contacts).where(eq(contacts.id, conv.contactId)).limit(1);
  const first = contact.name.split(/\s+/)[0];
  const vars = () => ({ contact: { ...contact, firstName: /^\d+$/.test(first) ? "" : first }, ...state!.vars });
  let handedOff = false;
  const [deal0] = conv.dealId ? await tx.select().from(deals).where(eq(deals.id, conv.dealId)).limit(1) : [];

  // Resposta a uma oferta de horários ou de lives
  if (node && (node.type === "schedule" || node.type === "live") && incomingText && state.vars._offer) {
    const offer = JSON.parse(state.vars._offer);
    const r =
      node.type === "schedule"
        ? await answerSlot(tx, { tenantId: conv.tenantId, d: node.data, deal: deal0, contact, vars: vars(), offer, answer: incomingText })
        : await answerLive(tx, { tenantId: conv.tenantId, d: node.data, deal: deal0, contact, vars: vars(), offer, answer: incomingText });
    replies.push(...r.replies);
    if (r.kind === "retry") {
      if (r.offer) state.vars._offer = JSON.stringify(r.offer);
      await save(tx, conv.id, state);
      return { replies, handedOff, triggers };
    }
    triggers.push(...r.triggers);
    delete state.vars._offer;
    const target = r.goto === "next" ? node.next : node.else;
    node = target ? byId.get(target) : undefined;
  }

  for (let step = 0; node && step < MAX_STEPS; step++) {
    switch (node.type) {
      case "message":
        replies.push(renderTemplate(node.data.text, vars()));
        node = node.next ? byId.get(node.next) : undefined;
        break;
      case "question":
        replies.push(renderTemplate(node.data.text, vars()));
        state.nodeId = node.id;
        await save(tx, conv.id, state);
        return { replies, handedOff, triggers };
      case "choice":
        replies.push(`${renderTemplate(node.data.text, vars())}\n${node.data.options.map((o, i) => `${i + 1}. ${o}`).join("\n")}`);
        state.nodeId = node.id;
        await save(tx, conv.id, state);
        return { replies, handedOff, triggers };
      case "condition": {
        const ok = (state.vars[node.data.variable] ?? "").toLowerCase() === node.data.equals.toLowerCase();
        const nextId: string | undefined = ok ? node.next : node.else;
        node = nextId ? byId.get(nextId) : undefined;
        break;
      }
      case "action": {
        if (node.data.action === "ADD_TAG") {
          const [tag] = await ensureTags(tx, conv.tenantId, [node.data.value]);
          await tx.insert(contactTags).values({ tenantId: conv.tenantId, contactId: conv.contactId, tagId: tag.id }).onConflictDoNothing();
        } else if (node.data.action === "MOVE_STAGE" && conv.dealId) {
          const r = await moveDeal(tx, conv.tenantId, null, conv.dealId, node.data.value);
          if (r.stageChanged) triggers.push({ type: "DEAL_STAGE_CHANGED", ctx: { dealId: conv.dealId, stageId: node.data.value, pipelineId: r.deal.pipelineId } });
        } else if (node.data.action === "SET_FIELD" && node.data.field) {
          const cf = { ...(contact.customFields ?? {}), [node.data.field]: renderTemplate(node.data.value, vars()) };
          await tx.update(contacts).set({ customFields: cf }).where(eq(contacts.id, contact.id));
        }
        node = node.next ? byId.get(node.next) : undefined;
        break;
      }
      case "qualify": {
        const d = node.data;
        const r = evaluateQualify(d, state.vars);
        const tagNames = r.qualified ? ["Qualificado", ...(r.tier ? [r.tier] : [])] : ["Não qualificado"];
        const tagRows = await ensureTags(tx, conv.tenantId, tagNames);
        for (const t of tagRows) await tx.insert(contactTags).values({ tenantId: conv.tenantId, contactId: contact.id, tagId: t.id }).onConflictDoNothing();
        const cf = { ...(contact.customFields ?? {}), ...Object.fromEntries(Object.entries(state.vars).filter(([k]) => !k.startsWith("_"))), qualificacao: r.qualified ? "Qualificado" : "Não qualificado", ...(r.tier && { porte: r.tier }) };
        [contact] = await tx.update(contacts).set({ customFields: cf }).where(eq(contacts.id, contact.id)).returning();

        const [deal] = conv.dealId ? await tx.select().from(deals).where(eq(deals.id, conv.dealId)).limit(1) : [];
        if (deal) {
          for (const t of tagRows) await tx.insert(dealTags).values({ tenantId: conv.tenantId, dealId: deal.id, tagId: t.id }).onConflictDoNothing();
          const target = r.qualified ? d.qualifiedStageId : d.nurtureStageId;
          if (target && target !== deal.stageId) {
            const m = await moveDeal(tx, conv.tenantId, null, deal.id, target);
            if (m.stageChanged) triggers.push({ type: "DEAL_STAGE_CHANGED", ctx: { dealId: deal.id, stageId: target, pipelineId: m.deal.pipelineId } });
          }
          await logActivity(tx, {
            tenantId: conv.tenantId,
            type: "AUTOMATION",
            summary: r.qualified ? `Robô: lead qualificado${r.tier ? ` (${r.tier})` : ""}` : `Robô: não qualificado (${r.failed.join(", ")})`,
            dealId: deal.id,
            contactId: contact.id,
            meta: { qualify: r },
          });
          if (r.qualified) {
            await queueConversion(tx, conv.tenantId, { dealId: deal.id, eventName: "QualifiedLead" });
            // Porte prioritário → responsável fixo (fora do rodízio)
            if (r.tier && d.priorityUserId && d.priorityTiers?.includes(r.tier)) {
              await tx.update(deals).set({ userId: d.priorityUserId }).where(eq(deals.id, deal.id));
              await tx.update(conversations).set({ assignedToId: d.priorityUserId }).where(eq(conversations.id, conv.id));
              await notify(tx, { tenantId: conv.tenantId, userId: d.priorityUserId, title: `Lead prioritário (${r.tier})`, body: deal.title, link: `/pipeline?deal=${deal.id}` });
            }
          } else {
            // Nutrição: sai da fila de atendimento e ganha uma tarefa de retomada
            await tx.update(conversations).set({ assignedToId: null }).where(eq(conversations.id, conv.id));
            const owner = deal.userId;
            if (owner && (d.followUpDays ?? 90) > 0) {
              await tx.insert(tasks).values({
                tenantId: conv.tenantId,
                userId: owner,
                dealId: deal.id,
                contactId: contact.id,
                title: `Retomar contato com ${contact.name} (nutrição)`,
                type: "WHATSAPP",
                dueDate: new Date(Date.now() + (d.followUpDays ?? 90) * 86_400_000),
              });
            }
          }
        }
        node = (r.qualified ? node.next : node.else) ? byId.get((r.qualified ? node.next : node.else)!) : undefined;
        break;
      }
      case "schedule":
      case "live": {
        const o = node.type === "schedule" ? await offerSlots(tx, conv.tenantId, node.data, deal0, vars()) : await offerLives(tx, node.data, vars());
        replies.push(...o.replies);
        if ("goto" in o) {
          node = node.else ? byId.get(node.else) : undefined;
          break;
        }
        state.vars._offer = JSON.stringify(o.offer);
        state.nodeId = node.id;
        await save(tx, conv.id, state);
        return { replies, handedOff, triggers };
      }
      case "handoff": {
        const oh = offHours(new Date(), node.data.hours);
        const txt = oh.off && node.data.offHoursText ? node.data.offHoursText : node.data.text;
        if (txt) replies.push(renderTemplate(txt, { ...vars(), atendimento: { quando: oh.quando, inicio: oh.inicio } }));
        // Mantém quem já foi definido (porte prioritário ou responsável do negócio); senão, rodízio
        const [c] = await tx.select({ a: conversations.assignedToId }).from(conversations).where(eq(conversations.id, conv.id)).limit(1);
        const [dd] = conv.dealId ? await tx.select({ u: deals.userId }).from(deals).where(eq(deals.id, conv.dealId)).limit(1) : [];
        const agent = c?.a ?? dd?.u ?? (await pickNextAgent(tx, conv.tenantId));
        await tx.update(conversations).set({ assignedToId: agent }).where(eq(conversations.id, conv.id));
        handedOff = true;
        node = undefined;
        break;
      }
    }
  }

  // Fim do fluxo: salva respostas no contato e encerra o bot
  state.done = true;
  await save(tx, conv.id, state);
  const publicVars = Object.fromEntries(Object.entries(state.vars).filter(([k]) => !k.startsWith("_")));
  if (Object.keys(publicVars).length) {
    await tx
      .update(contacts)
      .set({ customFields: { ...(contact.customFields ?? {}), ...publicVars } })
      .where(eq(contacts.id, contact.id));
  }
  return { replies, handedOff, triggers };
}

async function save(tx: Tx, conversationId: string, state: BotState) {
  await tx.update(conversations).set({ botState: state }).where(eq(conversations.id, conversationId));
}
