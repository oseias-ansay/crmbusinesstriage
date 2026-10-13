/**
 * Roteamento de entrada: decide em qual funil cai o lead novo e qual robô
 * atende, conforme o NÚMERO (conexão) que recebeu a mensagem.
 *
 * Ordem:
 *  1. regras da conexão por palavra-chave — procuradas na 1ª mensagem (a
 *     mensagem pré-preenchida do anúncio), no título/texto/link do anúncio e
 *     no id do anúncio. Ex.: "crm, sistema" → funil Venda de CRM;
 *  2. funil/robô padrão da conexão;
 *  3. sem roteamento configurado → comportamento antigo (funil padrão do
 *     tenant + robô ativo).
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { channelConnections, conversations, pipelines, stages, type Attribution, type RouteTarget } from "@/db/schema";

export type Route = { configured: boolean; pipelineId?: string; stageId?: string; botFlowId?: string | null; noBot?: boolean; rule?: string };

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** true se algum termo (separados por vírgula) aparece no texto. Termos com 8+ dígitos são comparados ao id do anúncio. */
export function matchesRule(match: string, text: string, att?: Attribution | null) {
  const hay = norm([text, att?.headline, att?.body, att?.sourceUrl].filter(Boolean).join(" \n "));
  return match
    .split(",")
    .map((t) => norm(t.trim()))
    .filter(Boolean)
    .some((t) => (/^\d{8,}$/.test(t) ? att?.adId === t : hay.includes(t)));
}

export async function resolveRoute(tx: Tx, connectionId: string | null | undefined, text: string, att?: Attribution | null): Promise<Route> {
  if (!connectionId) return { configured: false };
  const [c] = await tx.select({ routing: channelConnections.routing }).from(channelConnections).where(eq(channelConnections.id, connectionId)).limit(1);
  const r = c?.routing ?? {};
  const rule = (r.rules ?? []).find((x) => x.match?.trim() && matchesRule(x.match, text, att));
  const target: RouteTarget = { pipelineId: rule?.pipelineId || r.pipelineId, botFlowId: rule?.botFlowId || r.botFlowId };
  if (!target.pipelineId && !target.botFlowId) return { configured: false };

  let stageId: string | undefined;
  if (target.pipelineId) {
    const [st] = await tx
      .select({ id: stages.id })
      .from(stages)
      .innerJoin(pipelines, eq(pipelines.id, stages.pipelineId))
      .where(eq(stages.pipelineId, target.pipelineId))
      .orderBy(asc(stages.order))
      .limit(1);
    stageId = st?.id;
  }
  return {
    configured: true,
    pipelineId: stageId ? target.pipelineId : undefined,
    stageId,
    botFlowId: target.botFlowId && target.botFlowId !== "none" ? target.botFlowId : null,
    noBot: target.botFlowId === "none",
    rule: rule?.match,
  };
}

/**
 * Conversa de WhatsApp para mensagens automáticas (etapa, lembrete, automação).
 * Com dois números, prefere a conversa do próprio negócio — assim a mensagem
 * sai pelo número certo (consultoria × CRM); senão, a mais recente do contato.
 */
export async function pickWhatsappConversation(tx: Tx, contactId: string, dealId?: string | null) {
  const [conv] = await tx
    .select()
    .from(conversations)
    .where(and(eq(conversations.contactId, contactId), eq(conversations.channel, "WHATSAPP")))
    .orderBy(dealId ? sql`(${conversations.dealId} = ${dealId}) desc nulls last` : sql`1`, desc(conversations.lastMessageAt))
    .limit(1);
  return conv ?? null;
}
