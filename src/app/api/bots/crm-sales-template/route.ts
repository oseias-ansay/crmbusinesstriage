/**
 * POST { connectionId? } — cria o funil "Venda de CRM" (se não existir), o robô
 * de qualificação da venda de CRM e, se informado, liga o número a eles
 * (roteamento da conexão). O robô NÃO vira o padrão: só atende esse número.
 */
import { and, asc, eq, ilike } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db";
import { botFlows, channelConnections, pipelines, stages } from "@/db/schema";
import { ApiError, parseBody, route } from "@/lib/api";
import { buildCrmSalesFlow } from "@/lib/bot/crm-sales-flow";

const schema = z.object({ connectionId: z.string().uuid().optional() });

const STAGES = [
  { name: "Novo lead", color: "#94A3B8", probability: 10 },
  { name: "Qualificado", color: "#38BDF8", probability: 25 },
  { name: "Demonstração agendada", color: "#818CF8", probability: 40 },
  { name: "Proposta enviada", color: "#F59E0B", probability: 60 },
  { name: "Teste (trial)", color: "#F97316", probability: 75 },
  { name: "Implantação", color: "#14B8A6", probability: 90 },
  { name: "Ganho", color: "#10B981", probability: 100, isWon: true },
  { name: "Perdido", color: "#EF4444", probability: 0, isLost: true },
];

export const POST = route(async (req, { auth }) => {
  const body = await parseBody(req, schema);
  return withTenant(auth.tenantId, async (tx) => {
    const notes: string[] = [];
    const t = auth.tenantId;

    let [pipe] = await tx.select().from(pipelines).where(and(eq(pipelines.tenantId, t), ilike(pipelines.name, "venda de crm%"))).limit(1);
    if (!pipe) {
      [pipe] = await tx.insert(pipelines).values({ tenantId: t, name: "Venda de CRM", order: 10 }).returning();
      await tx.insert(stages).values(STAGES.map((s, i) => ({ tenantId: t, pipelineId: pipe.id, order: i, ...s })));
      notes.push('Funil "Venda de CRM" criado com 8 etapas.');
    }
    const st = await tx.select().from(stages).where(eq(stages.pipelineId, pipe.id)).orderBy(asc(stages.order));
    const qual = st.find((s) => /qualific/i.test(s.name)) ?? st[1] ?? st[0];
    const demo = st.find((s) => /demonstra/i.test(s.name));

    let [nut] = await tx.select().from(pipelines).where(and(eq(pipelines.tenantId, t), ilike(pipelines.name, "nutri%"))).limit(1);
    if (!nut) {
      [nut] = await tx.insert(pipelines).values({ tenantId: t, name: "Nutrição", order: 90 }).returning();
      await tx.insert(stages).values([
        { tenantId: t, pipelineId: nut.id, name: "Em nutrição", order: 0, color: "#94A3B8", probability: 5 },
        { tenantId: t, pipelineId: nut.id, name: "Retomar contato", order: 1, color: "#38BDF8", probability: 10 },
        { tenantId: t, pipelineId: nut.id, name: "Reativado", order: 2, color: "#10B981", probability: 20 },
      ]);
      notes.push('Funil "Nutrição" criado.');
    }
    const [nutStage] = await tx.select().from(stages).where(eq(stages.pipelineId, nut.id)).orderBy(asc(stages.order)).limit(1);

    const flow = buildCrmSalesFlow({ qualifiedStageId: qual?.id, nurtureStageId: nutStage?.id, demoStageId: demo?.id, priorityUserId: auth.userId });
    const [bot] = await tx.insert(botFlows).values({ tenantId: t, name: "Qualificação — Venda de CRM", channel: "WHATSAPP", isActive: false, flow }).returning();
    notes.push('Robô "Qualificação — Venda de CRM" criado (atende só o número ligado a ele).');

    if (body.connectionId) {
      const [c] = await tx.select().from(channelConnections).where(and(eq(channelConnections.id, body.connectionId), eq(channelConnections.tenantId, t))).limit(1);
      if (!c) throw new ApiError(404, "Conexão não encontrada");
      await tx.update(channelConnections).set({ routing: { ...(c.routing ?? {}), pipelineId: pipe.id, botFlowId: bot.id } }).where(eq(channelConnections.id, c.id));
      notes.push(`Número "${c.name}" ligado ao funil Venda de CRM e ao robô novo.`);
    }
    return { pipelineId: pipe.id, botId: bot.id, notes };
  });
}, { minRole: "ADMIN" });
