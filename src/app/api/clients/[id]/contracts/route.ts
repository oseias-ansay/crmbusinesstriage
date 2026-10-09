/** POST { templateId } — gera um contrato a partir da ficha do cliente (texto congelado). */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db";
import { clients, contractTemplates, contracts } from "@/db/schema";
import { ApiError, notFound, parseBody, route } from "@/lib/api";
import { contractVars, fillTemplate } from "@/lib/contracts/render";
import { nextContractNumber, tenantInfo } from "@/lib/services/clients";
import { logActivity } from "@/lib/activity";

const schema = z.object({ templateId: z.string().uuid() });

export const POST = route<{ id: string }>(async (req, { auth, params }) => {
  const { templateId } = await parseBody(req, schema);
  return withTenant(auth.tenantId, async (tx) => {
    const [c] = await tx.select().from(clients).where(eq(clients.id, params.id)).limit(1);
    if (!c) notFound("Cliente");
    const [tpl] = await tx.select().from(contractTemplates).where(eq(contractTemplates.id, templateId)).limit(1);
    if (!tpl) throw new ApiError(404, "Modelo não encontrado");
    const t = await tenantInfo(tx, auth.tenantId);
    const number = await nextContractNumber(tx, auth.tenantId);
    const { text, missing } = fillTemplate(tpl.body, contractVars(c, t.settings.company, number, t.name));
    const [k] = await tx
      .insert(contracts)
      .values({ tenantId: auth.tenantId, clientId: c.id, templateId: tpl.id, number, title: `${tpl.name} — ${c.razaoSocial}`, body: text, createdById: auth.userId })
      .returning();
    if (c.dealId) await logActivity(tx, { tenantId: auth.tenantId, type: "NOTE", summary: `Contrato ${number} gerado`, dealId: c.dealId, contactId: c.contactId, userId: auth.userId });
    return { ...k, missing };
  });
}, { minRole: "AGENT" });
