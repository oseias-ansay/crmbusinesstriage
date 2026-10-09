/**
 * POST { disableWelcomeWhatsapp?: boolean }
 * Cria o robô de qualificação da Business Triage (4 perguntas + bloco Qualificar),
 * o funil "Nutrição" (se não existir) e ativa o robô no WhatsApp.
 * Opcional: tira o envio de WhatsApp das automações de "negócio criado"
 * (o robô já cumprimenta o lead — evita mensagem em dobro).
 */
import { and, asc, eq, ilike, ne } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db";
import { automations, botFlows, pipelines, stages } from "@/db/schema";
import { ApiError, parseBody, route } from "@/lib/api";
import { buildQualificationFlow } from "@/lib/bot/qualification-flow";

const schema = z.object({ disableWelcomeWhatsapp: z.boolean().default(true) });

export const POST = route(async (req, { auth }) => {
  const body = await parseBody(req, schema);
  return withTenant(auth.tenantId, async (tx) => {
    const notes: string[] = [];

    // Etapa "Qualificação" do funil padrão (ou a 2ª etapa dele)
    const [def] = await tx.select().from(pipelines).where(eq(pipelines.isDefault, true)).limit(1);
    const [pipe] = def ? [def] : await tx.select().from(pipelines).orderBy(asc(pipelines.order)).limit(1);
    if (!pipe) throw new ApiError(422, "Crie um funil antes");
    const st = await tx.select().from(stages).where(eq(stages.pipelineId, pipe.id)).orderBy(asc(stages.order));
    const qualStage = st.find((s) => /qualifica/i.test(s.name)) ?? st.filter((s) => !s.isWon && !s.isLost)[1] ?? st[0];

    // Funil Nutrição
    let [nut] = await tx.select().from(pipelines).where(ilike(pipelines.name, "nutri%")).limit(1);
    let nutStage;
    if (!nut) {
      [nut] = await tx.insert(pipelines).values({ tenantId: auth.tenantId, name: "Nutrição", order: 90 }).returning();
      const created = await tx
        .insert(stages)
        .values([
          { tenantId: auth.tenantId, pipelineId: nut.id, name: "Em nutrição", order: 0, color: "#94A3B8", probability: 5 },
          { tenantId: auth.tenantId, pipelineId: nut.id, name: "Retomar contato", order: 1, color: "#38BDF8", probability: 10 },
          { tenantId: auth.tenantId, pipelineId: nut.id, name: "Reativado", order: 2, color: "#10B981", probability: 20 },
        ])
        .returning();
      nutStage = created[0];
      notes.push('Funil "Nutrição" criado.');
    } else {
      [nutStage] = await tx.select().from(stages).where(eq(stages.pipelineId, nut.id)).orderBy(asc(stages.order)).limit(1);
    }

    const schedStage = st.find((s) => /agend/i.test(s.name));
    const flow = buildQualificationFlow({ qualifiedStageId: qualStage?.id, nurtureStageId: nutStage?.id, scheduledStageId: schedStage?.id, priorityUserId: auth.userId });

    const [bot] = await tx.insert(botFlows).values({ tenantId: auth.tenantId, name: "Qualificação Business Triage", channel: "WHATSAPP", isActive: true, flow }).returning();
    await tx.update(botFlows).set({ isActive: false }).where(and(eq(botFlows.channel, "WHATSAPP"), ne(botFlows.id, bot.id)));
    notes.push(`Robô criado e ativo. Qualificado → "${pipe.name} › ${qualStage?.name}". Portes 3 e 4 vão para você.`);

    if (body.disableWelcomeWhatsapp) {
      const list = await tx.select().from(automations).where(eq(automations.triggerType, "DEAL_CREATED"));
      for (const a of list) {
        const kept = a.actionsJson.filter((x) => x.type !== "SEND_WHATSAPP");
        if (kept.length !== a.actionsJson.length) {
          await tx.update(automations).set({ actionsJson: kept, ...(kept.length === 0 && { isActive: false }) }).where(eq(automations.id, a.id));
          notes.push(`Mensagem de boas-vindas anterior (automação "${a.name}") substituída pela abertura do robô.`);
        }
      }
    }
    return { botId: bot.id, notes };
  });
}, { minRole: "ADMIN" });
