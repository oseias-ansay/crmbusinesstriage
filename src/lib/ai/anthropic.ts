/**
 * Cliente mínimo da API da Anthropic (Messages) + disjuntor de custo diário.
 * Usado pelo Copiloto de vendas. A chave é a do tenant (Integrações → IA);
 * sem ela, cai na chave geral do servidor (ANTHROPIC_API_KEY).
 */
import { sql } from "drizzle-orm";
import { withTenant } from "@/db";
import { aiUsage, type TenantSettings } from "@/db/schema";

export const DEFAULT_MODEL = process.env.AI_MODEL ?? "claude-haiku-4-5";

export type SystemBlock = { type: "text"; text: string; cache_control?: { type: "ephemeral" } };
export type ChatMsg = { role: "user" | "assistant"; content: string };
export type Usage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };

export function aiConfig(settings: TenantSettings) {
  const ai = settings.ai ?? {};
  return { apiKey: ai.apiKey || process.env.ANTHROPIC_API_KEY || "", model: ai.model || DEFAULT_MODEL, dailyLimit: ai.dailyLimit ?? 300 };
}

/** Soma 1 chamada no dia; devolve false se passou do limite (não chama a IA). */
export async function consumeQuota(tenantId: string, limit: number) {
  const day = new Date().toISOString().slice(0, 10);
  return withTenant(tenantId, async (tx) => {
    const [u] = await tx
      .insert(aiUsage)
      .values({ tenantId, day, calls: 1 })
      .onConflictDoUpdate({ target: [aiUsage.tenantId, aiUsage.day], set: { calls: sql`${aiUsage.calls} + 1` } })
      .returning();
    return u.calls <= limit;
  });
}

export async function callMessages(o: { apiKey: string; model: string; system: SystemBlock[]; messages: ChatMsg[]; maxTokens?: number; timeoutMs?: number }) {
  const res = await fetch(`${process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com"}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": o.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: o.model, max_tokens: o.maxTokens ?? 1200, system: o.system, messages: o.messages }),
    signal: AbortSignal.timeout(o.timeoutMs ?? 60_000),
  });
  const body = (await res.json().catch(() => ({}))) as { content?: { type: string; text?: string }[]; usage?: Usage; error?: { message?: string } };
  if (!res.ok) {
    const msg = body.error?.message ?? "erro";
    if (res.status === 401) throw new Error("Chave da Anthropic inválida. Confira em Configurações → Integrações → IA.");
    if (res.status === 429) throw new Error("A IA está sobrecarregada no momento. Tente de novo em alguns segundos.");
    if (/credit|billing|balance/i.test(msg)) throw new Error("Sem créditos na conta da Anthropic. Adicione saldo no console da Anthropic.");
    throw new Error(`Anthropic ${res.status}: ${msg}`);
  }
  const text = (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
  return { text, usage: body.usage ?? {} };
}
