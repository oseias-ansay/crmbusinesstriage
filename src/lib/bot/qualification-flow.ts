/**
 * Fluxo padrão da Business Triage: abertura → 4 perguntas → Qualificar →
 *   qualificado: "agendar atendimento (30 min, online)" ou "live" → agenda/inscreve;
 *   não qualificado: convite para a live (nutrição).
 * Usado pelo botão "Robô de qualificação (modelo)" e pelo script SQL de atualização.
 */
import { END, type BotFlowDef } from "./types";

export const P1 = ["Sim, há mais de 1 ano", "Sim, há menos de 1 ano", "Ainda vou abrir"];
export const P2 = ["Até R$ 30 mil", "De R$ 30 mil a R$ 100 mil", "De R$ 100 mil a R$ 500 mil", "Acima de R$ 500 mil"];
export const P3 = ["O dinheiro entra, mas some: o caixa vive apertado", "Preciso vender mais ou vender melhor", "Falta organização e controle na gestão", "Só estou conhecendo"];
export const P4 = ["Agora, neste mês", "Nos próximos 3 meses", "Sem pressa, estou pesquisando"];
export const PREF = ["Agendar um atendimento personalizado (30 min, online)", "Participar de uma live para saber mais"];

const HOURS = { start: "09:00", end: "17:00", tz: "America/Sao_Paulo" };

export function buildQualificationFlow(ids: { qualifiedStageId?: string; nurtureStageId?: string; scheduledStageId?: string; priorityUserId?: string }): BotFlowDef {
  const live = (intro: string) => ({
    intro,
    confirmText: 'Inscrição confirmada ✅ "{{live.titulo}}", {{live.data}}. Vou te lembrar na véspera e mandar o link 30 minutos antes.',
    noLivesText: "Ainda não temos live marcada. Assim que tiver, te aviso por aqui.",
    max: 3,
  });
  return {
    startNodeId: "q0",
    nodes: [
      { id: "q0", type: "message", data: { text: "Olá, {{contact.firstName}}! Aqui é a Business Triage. Para eu te indicar o caminho certo, são 4 perguntas rápidas (menos de 1 minuto). É só responder com o número." }, next: "q1" },
      { id: "q1", type: "choice", data: { text: "1/4 · A empresa já está em funcionamento?", variable: "empresa_funcionamento", options: P1 }, next: "q2" },
      { id: "q2", type: "choice", data: { text: "2/4 · Qual o faturamento médio por mês?", variable: "faturamento", options: P2 }, next: "q3" },
      { id: "q3", type: "choice", data: { text: "3/4 · O que mais pesa hoje?", variable: "principal_dor", options: P3 }, next: "q4" },
      { id: "q4", type: "choice", data: { text: "4/4 · Quando você quer resolver isso?", variable: "prazo", options: P4 }, next: "qq" },
      {
        id: "qq",
        type: "qualify",
        data: {
          rules: [
            { variable: "empresa_funcionamento", accept: [P1[0], P1[1]] },
            { variable: "principal_dor", accept: [P3[0], P3[1], P3[2]] },
            { variable: "prazo", accept: [P4[0], P4[1]] },
          ],
          tier: { variable: "faturamento", map: { [P2[0]]: "Porte 1", [P2[1]]: "Porte 2", [P2[2]]: "Porte 3", [P2[3]]: "Porte 4" } },
          qualifiedStageId: ids.qualifiedStageId,
          nurtureStageId: ids.nurtureStageId,
          priorityTiers: ["Porte 3", "Porte 4"],
          priorityUserId: ids.priorityUserId,
          followUpDays: 90,
        },
        next: "qp",
        else: "qno",
      },
      // Qualificado: escolhe o caminho
      { id: "qp", type: "choice", data: { text: "Pelo que você contou, um diagnóstico faz sentido para a sua empresa: ele mostra onde está o problema e o que fazer primeiro. Como você prefere seguir?", variable: "preferencia", options: PREF }, next: "qc" },
      { id: "qc", type: "condition", data: { variable: "preferencia", equals: PREF[0] }, next: "qs", else: "ql" },
      {
        id: "qs",
        type: "schedule",
        data: {
          intro: "Ótimo! Estes são os próximos horários livres para o atendimento (30 min, online). Responda com o número:",
          confirmText: "Agendado ✅ {{agendamento.data}} (30 min, online). {{agendamento.linkTexto}} Se precisar remarcar, é só responder aqui.",
          durationMin: 30,
          slots: 4,
          minLeadMin: 120,
          daysAhead: 7,
          reminderMin: 60,
          hours: HOURS,
          stageId: ids.scheduledStageId,
        },
        next: END,
        else: "qh",
      },
      { id: "ql", type: "live", data: live("Ótimo! Estas são as próximas lives. Responda com o número da que você quer participar:"), next: END, else: "qh" },
      {
        id: "qh",
        type: "handoff",
        data: {
          text: "Sem problema. Um especialista vai falar com você por aqui para encontrar o melhor horário.",
          offHoursText: "Sem problema. Nosso time atende de segunda a sexta, das 9h às 17h: um especialista vai falar com você {{atendimento.quando}}, a partir das 9h, para encontrar o melhor horário.",
          hours: HOURS,
        },
      },
      // Não qualificado: nutrição com a live
      { id: "qno", type: "message", data: { text: "Obrigado pelas respostas, {{contact.firstName}}. Neste momento, o diagnóstico completo ainda não é o melhor passo para você, mas temos uma live gratuita que trata justamente dessa fase." }, next: "qn2" },
      { id: "qn2", type: "live", data: live("Estas são as próximas datas. Responda com o número da que você quer participar:"), next: END, else: "qbye" },
      { id: "qbye", type: "message", data: { text: "Sem problema. Quando quiser, é só me chamar aqui." }, next: END },
    ],
  };
}
