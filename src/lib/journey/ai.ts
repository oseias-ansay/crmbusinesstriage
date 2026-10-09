/**
 * ════════════════════════════════════════════════════════════════════
 *  IA que lê a conversa e avança o card no funil
 * ════════════════════════════════════════════════════════════════════
 *  Fluxo: mensagem recebida → agenda uma análise para daqui a ~90 s
 *  (se chegarem mais mensagens, a análise é adiada: lê a conversa inteira
 *  de uma vez, não frase a frase) → a IA escolhe a etapa que melhor
 *  descreve o momento do cliente, com nível de confiança e motivo.
 *
 *  Regras de segurança:
 *   - só AVANÇA (nunca volta o card);
 *   - não marca Ganho/Perdido sozinha: notifica o responsável sugerindo;
 *   - exige confiança mínima (padrão 0,7);
 *   - disjuntor de custo: limite diário de análises por tenant;
 *   - tudo fica registrado na linha do tempo do negócio, com o motivo.
 */
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { withTenant, type Tx } from "@/db";
import { aiUsage, conversations, deals, messages, pipelines, scheduledJobs, stages, tenants } from "@/db/schema";
import { moveDeal } from "@/lib/services/deals";
import { logActivity, notify } from "@/lib/activity";
import { emitToTenant } from "@/lib/realtime";

const DEBOUNCE_MS = 90_000;
const DEFAULT_MODEL = process.env.AI_MODEL ?? "claude-haiku-4-5";

/** Agenda (ou adia) a análise do negócio. Chamado a cada mensagem recebida. */
export async function scheduleAiClassify(tx: Tx, tenantId: string, dealId: string) {
  const [d] = await tx
    .select({ status: deals.status, aiAutoMove: pipelines.aiAutoMove })
    .from(deals)
    .innerJoin(pipelines, eq(pipelines.id, deals.pipelineId))
    .where(eq(deals.id, dealId))
    .limit(1);
  if (!d || d.status !== "OPEN" || !d.aiAutoMove) return;

  const runAt = new Date(Date.now() + DEBOUNCE_MS);
  const updated = await tx
    .update(scheduledJobs)
    .set({ runAt })
    .where(and(eq(scheduledJobs.kind, "AI_CLASSIFY"), isNull(scheduledJobs.doneAt), sql`${scheduledJobs.payload}->>'dealId' = ${dealId}`))
    .returning({ id: scheduledJobs.id });
  if (!updated.length) {
    await tx.insert(scheduledJobs).values({ tenantId, kind: "AI_CLASSIFY", payload: { dealId }, runAt });
  }
}

type Decision = { etapa: number; confianca: number; motivo: string };

async function callClaude(apiKey: string, model: string, system: string, user: string): Promise<string> {
  const res = await fetch(`${process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com"}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 300, system, messages: [{ role: "user", content: user }] }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => ({}))) as { content?: { type: string; text?: string }[]; error?: { message?: string } };
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${body.error?.message ?? "erro"}`);
  return body.content?.find((c) => c.type === "text")?.text ?? "";
}

export function parseDecision(text: string): Decision | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as Partial<Decision>;
    if (typeof j.etapa !== "number") return null;
    return { etapa: j.etapa, confianca: Math.max(0, Math.min(1, Number(j.confianca ?? 0))), motivo: String(j.motivo ?? "").slice(0, 300) };
  } catch {
    return null;
  }
}

/** Executa a análise (chamado pelo worker). Devolve o que aconteceu, para log. */
export async function runAiClassify(tenantId: string, dealId: string): Promise<Record<string, unknown>> {
  const ctx = await withTenant(tenantId, async (tx) => {
    const [deal] = await tx.select().from(deals).where(eq(deals.id, dealId)).limit(1);
    if (!deal || deal.status !== "OPEN") return null;
    const [pipe] = await tx.select().from(pipelines).where(eq(pipelines.id, deal.pipelineId)).limit(1);
    if (!pipe?.aiAutoMove) return null;
    const st = await tx.select().from(stages).where(eq(stages.pipelineId, deal.pipelineId)).orderBy(asc(stages.order));
    const msgs = await tx
      .select({ senderType: messages.senderType, content: messages.content, type: messages.type, createdAt: messages.timestamp })
      .from(messages)
      .where(and(eq(messages.dealId, dealId), eq(messages.isInternalNote, false)))
      .orderBy(desc(messages.timestamp))
      .limit(30);
    const [t] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    // Robô de triagem ainda perguntando → a IA espera ele terminar
    const convs = await tx.select({ s: conversations.botState }).from(conversations).where(eq(conversations.dealId, dealId));
    if (convs.some((c) => c.s && !c.s.done)) return null;
    return { deal, stages: st, msgs: msgs.reverse(), settings: t.settings };
  });
  if (!ctx) return { skipped: "negócio fechado ou IA desligada no funil" };

  const ai = ctx.settings.ai ?? {};
  const apiKey = ai.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { skipped: "sem chave da Anthropic" };
  if (!ctx.msgs.some((m) => m.senderType === "CONTACT")) return { skipped: "sem mensagens do cliente" };

  // Disjuntor de custo
  const day = new Date().toISOString().slice(0, 10);
  const limit = ai.dailyLimit ?? 300;
  const allowed = await withTenant(tenantId, async (tx) => {
    const [u] = await tx
      .insert(aiUsage)
      .values({ tenantId, day, calls: 1 })
      .onConflictDoUpdate({ target: [aiUsage.tenantId, aiUsage.day], set: { calls: sql`${aiUsage.calls} + 1` } })
      .returning();
    return u.calls <= limit;
  });
  if (!allowed) return { skipped: `limite diário de ${limit} análises atingido` };

  const current = ctx.stages.findIndex((s) => s.id === ctx.deal.stageId);
  const lista = ctx.stages
    .map((s, i) => `${i + 1}. ${s.name}${s.isWon ? " [GANHO]" : s.isLost ? " [PERDIDO]" : ""}${s.aiCriteria ? ` — quando: ${s.aiCriteria}` : ""}`)
    .join("\n");
  let total = 0;
  const conversa = ctx.msgs
    .map((m) => {
      const quem = m.senderType === "CONTACT" ? "Cliente" : "Empresa";
      const txt = m.type === "TEXT" ? m.content.slice(0, 600) : `[${m.type.toLowerCase()}] ${m.content.slice(0, 200)}`;
      return `${quem}: ${txt}`;
    })
    .reverse()
    .filter((l) => (total += l.length) < 8000)
    .reverse()
    .join("\n");

  const system =
    "Você classifica em que etapa do funil de vendas um cliente está, lendo a conversa de WhatsApp entre a empresa e o cliente. " +
    "Responda APENAS com um JSON: {\"etapa\": <número da etapa>, \"confianca\": <0 a 1>, \"motivo\": \"<frase curta em português>\"}. " +
    "Escolha a etapa que descreve o momento ATUAL do cliente segundo os critérios. Se não houver evidência clara de avanço, repita a etapa atual. " +
    "Só escolha uma etapa [GANHO] se o cliente confirmou claramente a contratação/pagamento, e [PERDIDO] se recusou claramente.";
  const user = `Etapas do funil:\n${lista}\n\nEtapa atual: ${current + 1}. ${ctx.stages[current]?.name}\n\nConversa (mais antiga → mais recente):\n${conversa}`;

  const raw = await callClaude(apiKey, ai.model || DEFAULT_MODEL, system, user);
  const d = parseDecision(raw);
  if (!d) return { skipped: "resposta da IA sem JSON", raw: raw.slice(0, 200) };

  const target = ctx.stages[d.etapa - 1];
  const minConf = ai.minConfidence ?? 0.7;
  if (!target || d.etapa - 1 === current) return { decisao: d, acao: "manter" };
  if (d.confianca < minConf) return { decisao: d, acao: `confiança abaixo de ${minConf}` };

  // Ganho/Perdido: só sugere ao responsável
  if (target.isWon || target.isLost) {
    await withTenant(tenantId, async (tx) => {
      await logActivity(tx, { tenantId, type: "AUTOMATION", summary: `🤖 IA sugere marcar como ${target.isWon ? "GANHO" : "PERDIDO"}: ${d.motivo}`, dealId, contactId: ctx.deal.contactId });
      if (ctx.deal.userId) {
        await notify(tx, { tenantId, userId: ctx.deal.userId, title: `IA sugere: ${target.isWon ? "negócio ganho" : "negócio perdido"}`, body: `${ctx.deal.title} — ${d.motivo}`, link: `/pipeline?deal=${dealId}` });
      }
    });
    return { decisao: d, acao: "sugestão enviada" };
  }
  // Só avança
  if (target.order <= (ctx.stages[current]?.order ?? -1)) return { decisao: d, acao: "não volta etapas" };

  const res = await withTenant(tenantId, async (tx) => {
    const r = await moveDeal(tx, tenantId, null, dealId, target.id);
    await logActivity(tx, { tenantId, type: "AUTOMATION", summary: `🤖 IA moveu para "${target.name}": ${d.motivo}`, dealId, contactId: ctx.deal.contactId, meta: { ai: d } });
    return r;
  });
  emitToTenant(tenantId, "deal:moved", res.deal);
  if (res.stageChanged) {
    // import tardio evita ciclo engine ↔ journey
    const { fireTrigger } = await import("@/lib/automation/engine");
    fireTrigger(tenantId, "DEAL_STAGE_CHANGED", { dealId, stageId: target.id, pipelineId: res.deal.pipelineId, depth: 1 });
  }
  return { decisao: d, acao: `movido para ${target.name}` };
}
