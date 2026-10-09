/** Envia um evento de TESTE para a Meta e devolve a resposta (botão "Testar conexão"). */
import { eq } from "drizzle-orm";
import { withTenant } from "@/db";
import { tenants } from "@/db/schema";
import { ApiError, route } from "@/lib/api";
import { buildEvent, postToMeta } from "@/lib/meta/capi";

export const POST = route(async (_req, { auth }) => {
  const s = await withTenant(auth.tenantId, async (tx) => {
    const [t] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, auth.tenantId));
    return t.settings.meta;
  });
  if (!s?.datasetId || !s.accessToken) throw new ApiError(422, "Preencha o ID do conjunto de dados e o token antes de testar");
  if (!s.testEventCode) throw new ApiError(422, "Para o teste, preencha o Código de teste (aba Eventos de teste do Gerenciador de Eventos)");
  const ev = buildEvent(
    { id: `teste-${Date.now()}`, eventName: "Lead", eventTime: new Date(), value: null, dealId: null },
    { id: "teste", name: "Teste CRM", phone: "5541999999999", email: "teste@exemplo.com.br", attribution: { channel: "meta_ctwa" } },
    s,
  );
  const out = await postToMeta(s, [ev]);
  return { ok: out.ok, status: out.status, resposta: out.body };
}, { minRole: "ADMIN" });
