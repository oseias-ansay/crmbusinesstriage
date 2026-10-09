/**
 * Formato do fluxo do Bot Builder (bot_flows.flow).
 * Grafo simples de nós encadeados por `next`; `condition` usa `else`.
 */
export type BotNode =
  | { id: string; type: "message"; data: { text: string }; next?: string }
  | { id: string; type: "question"; data: { text: string; variable: string }; next?: string }
  | { id: string; type: "choice"; data: { text: string; variable: string; options: string[] }; next?: string }
  | { id: string; type: "condition"; data: { variable: string; equals: string }; next?: string; else?: string }
  | { id: string; type: "action"; data: { action: "ADD_TAG" | "MOVE_STAGE" | "SET_FIELD"; value: string; field?: string }; next?: string }
  | { id: string; type: "handoff"; data: HandoffData }
  | { id: string; type: "qualify"; data: QualifyData; next?: string; else?: string }
  | { id: string; type: "schedule"; data: ScheduleData; next?: string; else?: string }
  | { id: string; type: "live"; data: LiveData; next?: string; else?: string };

/** Fim explícito do fluxo (para o editor não encadear no próximo bloco). */
export const END = "__end__";

/**
 * Agendar atendimento: oferece os próximos horários livres (dentro do
 * expediente, sem conflito com reuniões já marcadas para o responsável).
 * Escolheu → tarefa de reunião, card na etapa, lembrete → segue em `next`.
 * "Nenhum desses horários" → segue em `else`.
 */
export type ScheduleData = {
  intro: string;
  confirmText: string; // {{agendamento.data}} {{agendamento.linkTexto}}
  durationMin?: number; // 30
  slots?: number; // quantos horários oferecer (4)
  minLeadMin?: number; // antecedência mínima (120)
  daysAhead?: number; // janela de dias úteis (7)
  hours?: HandoffData["hours"];
  meetingLink?: string; // sala fixa do Google Meet, por ex.
  stageId?: string; // etapa do card ao agendar
  userId?: string; // responsável fixo (vazio = responsável do negócio)
  reminderMin?: number; // lembrete ao contato antes (60)
};

/**
 * Live: oferece as próximas lives cadastradas. Inscreveu → tag, lembretes,
 * segue em `next`. Recusou ou não há live → segue em `else`.
 */
export type LiveData = {
  intro: string;
  confirmText: string; // {{live.titulo}} {{live.data}} {{live.link}}
  noLivesText?: string;
  max?: number; // quantas lives listar (3)
};

/**
 * Transferir para humano. Fora do expediente envia `offHoursText`.
 * Expediente padrão: segunda a sexta, 9h–17h (Brasília), exceto feriados nacionais.
 * Em `offHoursText`, {{atendimento.quando}} vira "hoje", "amanhã" ou
 * "na segunda-feira (13/10)" — sempre o próximo dia útil.
 */
export type HandoffData = {
  text?: string;
  offHoursText?: string;
  hours?: { start: string; end: string; tz?: string; extraHolidays?: string[] }; // "09:00", "17:00", ["09-08"]
};

export const DEFAULT_HOURS = { start: "09:00", end: "17:00", tz: "America/Sao_Paulo" };

const pad = (n: number) => String(n).padStart(2, "0");

/** Domingo de Páscoa (algoritmo de Meeus/Butcher). */
function easter(y: number) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(y, month - 1, day);
}

/** Feriados nacionais + Carnaval, Sexta-feira Santa e Corpus Christi ("MM-DD"). */
export function holidays(y: number): Set<string> {
  const fixed = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"];
  const e = easter(y);
  const rel = [-48, -47, -2, 60].map((off) => {
    const d = new Date(e + off * 86_400_000);
    return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  });
  return new Set([...fixed, ...rel]);
}

/** Dia útil? (y/m/d do calendário local; m = 1–12) */
export function isBusinessDate(y: number, m: number, d: number, extra: string[] = []) {
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const md = `${pad(m)}-${pad(d)}`;
  return wd !== 0 && wd !== 6 && !holidays(y).has(md) && !extra.includes(md);
}

export const WEEK = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

/**
 * Está fora do expediente? Devolve também quando será o próximo atendimento.
 * Datas calculadas no fuso do expediente, sem depender do fuso do servidor.
 */
export function offHours(now: Date, h: HandoffData["hours"] = DEFAULT_HOURS) {
  const tz = h?.tz || DEFAULT_HOURS.tz;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const t = `${parts.hour}${parts.minute}`;
  const start = (h?.start || DEFAULT_HOURS.start).replace(/\D/g, "").padStart(4, "0");
  const end = (h?.end || DEFAULT_HOURS.end).replace(/\D/g, "").padStart(4, "0");
  const extra = new Set(h?.extraHolidays ?? []);
  // "dia civil" local representado em UTC (só para contar dias e semana)
  const today = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  const isBusiness = (ms: number) => {
    const d = new Date(ms);
    const md = `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const wd = d.getUTCDay();
    return wd !== 0 && wd !== 6 && !holidays(d.getUTCFullYear()).has(md) && !extra.has(md);
  };
  const off = !isBusiness(today) || t < start || t >= end;

  // próximo dia útil com atendimento: hoje (se ainda não começou), senão os dias seguintes
  let next = isBusiness(today) && t < start ? today : today + 86_400_000;
  for (let i = 0; i < 15 && !isBusiness(next); i++) next += 86_400_000;
  const diff = Math.round((next - today) / 86_400_000);
  const nd = new Date(next);
  const quando = diff === 0 ? "hoje" : diff === 1 ? "amanhã" : `na ${WEEK[nd.getUTCDay()]} (${pad(nd.getUTCDate())}/${pad(nd.getUTCMonth() + 1)})`;
  return { off, quando, inicio: `${Number(start.slice(0, 2))}h${start.slice(2) === "00" ? "" : start.slice(2)}` };
}

/**
 * Bloco "Qualificar": avalia as respostas e separa o lead.
 *  - qualificado (todas as regras aceitas) → segue em `next`
 *  - não qualificado → segue em `else`
 */
export type QualifyData = {
  rules: { variable: string; accept: string[] }[]; // TODAS precisam passar
  tier?: { variable: string; map: Record<string, string> }; // resposta → tag de porte (não exclui)
  qualifiedStageId?: string; // etapa do card quando qualificado
  nurtureStageId?: string; // etapa do card quando não qualificado (funil Nutrição)
  priorityTiers?: string[]; // portes que vão para um responsável fixo
  priorityUserId?: string;
  followUpDays?: number; // tarefa de retomar contato com o não qualificado
};

/** Avalia as regras (mesma função no servidor e no simulador). */
export function evaluateQualify(d: QualifyData, vars: Record<string, string>) {
  const norm = (x: string) => x.trim().toLowerCase();
  const failed = d.rules.filter((r) => !r.accept.map(norm).includes(norm(vars[r.variable] ?? "")));
  const tier = d.tier ? d.tier.map[vars[d.tier.variable] ?? ""] ?? Object.entries(d.tier.map).find(([k]) => norm(k) === norm(vars[d.tier!.variable] ?? ""))?.[1] : undefined;
  return { qualified: failed.length === 0, failed: failed.map((r) => r.variable), tier };
}

export type BotFlowDef = { startNodeId: string; nodes: BotNode[] };

export const NODE_LABELS: Record<BotNode["type"], string> = {
  message: "Mensagem",
  question: "Pergunta (texto livre)",
  choice: "Múltipla escolha",
  condition: "Condição",
  action: "Ação no CRM",
  handoff: "Transferir para humano",
  qualify: "Qualificar lead",
  schedule: "Agendar atendimento",
  live: "Inscrever em live",
};
