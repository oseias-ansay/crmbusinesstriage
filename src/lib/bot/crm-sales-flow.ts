/**
 * Robô de qualificação da VENDA DE CRM (número próprio de WhatsApp).
 * 4 perguntas → qualifica pelo prazo (equipe só classifica) → qualificado
 * agenda uma demonstração online de 30 min; não qualificado vai para nutrição.
 * Grava em "qualificacao_crm" para não conflitar com o robô da consultoria.
 */
import { END, type BotFlowDef } from "./types";

export const C1 = ["Só eu", "2 a 5 pessoas", "6 a 15 pessoas", "Mais de 15 pessoas"];
export const C2 = ["Caderno, planilha ou só no WhatsApp", "Já uso outro CRM", "Ainda não tenho controle nenhum"];
export const C3 = ["WhatsApp", "Instagram / Facebook", "Indicação ou loja física", "Site / Google"];
export const C4 = ["Agora, neste mês", "Nos próximos 3 meses", "Só estou pesquisando"];

const HOURS = { start: "09:00", end: "17:00", tz: "America/Sao_Paulo" };

export function buildCrmSalesFlow(ids: { qualifiedStageId?: string; nurtureStageId?: string; demoStageId?: string; priorityUserId?: string }): BotFlowDef {
  return {
    startNodeId: "c0",
    nodes: [
      { id: "c0", type: "message", data: { text: "Olá, {{contact.firstName}}! Aqui é a Business Triage. Que bom que você quer conhecer o nosso CRM. São 4 perguntas rápidas para eu te mostrar o que faz sentido para a sua empresa. É só responder com o número." }, next: "c1" },
      { id: "c1", type: "choice", data: { text: "1/4 · Quantas pessoas atendem ou vendem na sua empresa?", variable: "equipe_comercial", options: C1 }, next: "c2" },
      { id: "c2", type: "choice", data: { text: "2/4 · Como vocês organizam os clientes e as vendas hoje?", variable: "controle_atual", options: C2 }, next: "c3" },
      { id: "c3", type: "choice", data: { text: "3/4 · Por onde chega a maioria dos seus clientes?", variable: "canal_principal", options: C3 }, next: "c4" },
      { id: "c4", type: "choice", data: { text: "4/4 · Quando você quer começar a usar um CRM?", variable: "prazo_crm", options: C4 }, next: "cq" },
      {
        id: "cq",
        type: "qualify",
        data: {
          rules: [{ variable: "prazo_crm", accept: [C4[0], C4[1]] }],
          tier: { variable: "equipe_comercial", map: { [C1[0]]: "Equipe 1", [C1[1]]: "Equipe 2-5", [C1[2]]: "Equipe 6-15", [C1[3]]: "Equipe 15+" } },
          qualifiedStageId: ids.qualifiedStageId,
          nurtureStageId: ids.nurtureStageId,
          priorityTiers: ["Equipe 6-15", "Equipe 15+"],
          priorityUserId: ids.priorityUserId,
          followUpDays: 60,
          field: "qualificacao_crm",
          extraTags: ["Interesse CRM"],
        },
        next: "cs",
        else: "cno",
      },
      {
        id: "cs",
        type: "schedule",
        data: {
          intro: "Ótimo! A demonstração é online e leva 30 minutos: mostro o CRM funcionando no dia a dia de uma empresa como a sua. Estes são os próximos horários livres. Responda com o número:",
          confirmText: "Demonstração agendada ✅ {{agendamento.data}} (30 min, online). {{agendamento.linkTexto}} Se precisar remarcar, é só responder aqui.",
          durationMin: 30,
          slots: 4,
          minLeadMin: 120,
          daysAhead: 7,
          reminderMin: 60,
          hours: HOURS,
          stageId: ids.demoStageId,
        },
        next: END,
        else: "ch",
      },
      {
        id: "ch",
        type: "handoff",
        data: {
          text: "Sem problema. Um especialista vai falar com você por aqui para combinar o melhor horário da demonstração.",
          offHoursText: "Sem problema. Nosso time atende de segunda a sexta, das 9h às 17h: um especialista vai falar com você {{atendimento.quando}}, a partir das 9h, para combinar a demonstração.",
          hours: HOURS,
        },
      },
      { id: "cno", type: "message", data: { text: "Obrigado pelas respostas, {{contact.firstName}}! Quando chegar a hora de organizar as suas vendas, é só me chamar aqui que eu te mostro o CRM funcionando." }, next: END },
    ],
  };
}
