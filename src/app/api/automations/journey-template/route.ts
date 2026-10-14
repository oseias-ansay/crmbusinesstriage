/**
 * POST → cria as automações da jornada depois da venda (só as que ainda não existem):
 *  - Consultoria ganha (Vendas)        → card em Execução do Diagnóstico (tag Consultoria) + tarefa
 *  - CRM ganho (Venda de CRM)          → card em Onboarding (tag CRM) + tarefa de kickoff
 *  - Relatório entregue (Execução)     → card em Pós-Venda (tag Consultoria) + acompanhamento
 *  - Ativo (Onboarding)                → card em Pós-Venda (tag CRM) + acompanhamento
 * O card ganho continua ganho: o próximo funil recebe um card NOVO do mesmo contato.
 */
import { asc, eq } from "drizzle-orm";
import { withTenant } from "@/db";
import { automations, pipelines, stages, type AutomationAction } from "@/db/schema";
import { route } from "@/lib/api";

type Pipe = { id: string; name: string; isDefault: boolean; stages: { id: string; name: string; isWon: boolean; isLost: boolean }[] };

export const POST = route(async (_req, { auth }) =>
  withTenant(auth.tenantId, async (tx) => {
    const t = auth.tenantId;
    const ps = await tx.select().from(pipelines).where(eq(pipelines.tenantId, t)).orderBy(asc(pipelines.order));
    const ss = await tx.select().from(stages).where(eq(stages.tenantId, t)).orderBy(asc(stages.order));
    const all: Pipe[] = ps.map((p) => ({ ...p, stages: ss.filter((s) => s.pipelineId === p.id) }));
    const find = (re: RegExp) => all.find((p) => re.test(p.name));
    const open = (p?: Pipe) => p?.stages.filter((s) => !s.isWon && !s.isLost) ?? [];

    const vendas = all.find((p) => /^vendas$/i.test(p.name)) ?? all.find((p) => p.isDefault);
    const crm = find(/venda de crm/i);
    const exec = find(/triagem business|execu[cç][aã]o do diagn/i);
    const onb = find(/onboarding|implanta/i);
    const pos = find(/p[oó]s[- ]?venda/i);

    const plan: { name: string; triggerType: "DEAL_WON" | "DEAL_STAGE_CHANGED"; conditions: Record<string, string>; action: AutomationAction; ok: boolean; why: string }[] = [
      {
        name: "Consultoria ganha → Execução do Diagnóstico",
        triggerType: "DEAL_WON",
        conditions: { pipelineId: vendas?.id ?? "" },
        action: { type: "CREATE_DEAL", params: { stageId: open(exec)[0]?.id ?? "", title: "Diagnóstico — {{contact.name}}", tags: "Consultoria", taskTitle: "Coletar documentos do diagnóstico — {{contact.name}}", taskDueHours: 24 } },
        ok: !!(vendas && open(exec)[0]),
        why: 'faltam os funis "Vendas" e/ou "Triagem Business"',
      },
      {
        name: "CRM ganho → Onboarding",
        triggerType: "DEAL_WON",
        conditions: { pipelineId: crm?.id ?? "" },
        action: { type: "CREATE_DEAL", params: { stageId: open(onb)[0]?.id ?? "", title: "Implantação CRM — {{contact.name}}", tags: "CRM", taskTitle: "Agendar kickoff de implantação do CRM — {{contact.name}}", taskDueHours: 24 } },
        ok: !!(crm && open(onb)[0]),
        why: 'faltam os funis "Venda de CRM" e/ou "Onboarding"',
      },
      {
        name: "Diagnóstico entregue → Pós-Venda",
        triggerType: "DEAL_STAGE_CHANGED",
        conditions: { stageId: open(exec).at(-1)?.id ?? "" },
        action: { type: "CREATE_DEAL", params: { stageId: open(pos)[0]?.id ?? "", title: "Pós-venda Consultoria — {{contact.name}}", tags: "Consultoria", taskTitle: "Acompanhamento do plano de ação — {{contact.name}}", taskDueHours: 24 * 7 } },
        ok: !!(open(exec).length && open(pos)[0]),
        why: 'faltam os funis "Triagem Business" e/ou "Pós-Venda"',
      },
      {
        name: "CRM ativo → Pós-Venda",
        triggerType: "DEAL_STAGE_CHANGED",
        conditions: { stageId: open(onb).at(-1)?.id ?? "" },
        action: { type: "CREATE_DEAL", params: { stageId: open(pos)[0]?.id ?? "", title: "Pós-venda CRM — {{contact.name}}", tags: "CRM", taskTitle: "Acompanhar uso do CRM (30 dias) — {{contact.name}}", taskDueHours: 24 * 30 } },
        ok: !!(open(onb).length && open(pos)[0]),
        why: 'faltam os funis "Onboarding" e/ou "Pós-Venda"',
      },
    ];

    const existing = new Set((await tx.select({ name: automations.name }).from(automations).where(eq(automations.tenantId, t))).map((a) => a.name));
    const notes: string[] = [];
    for (const p of plan) {
      if (existing.has(p.name)) { notes.push(`"${p.name}" já existia.`); continue; }
      if (!p.ok) { notes.push(`"${p.name}" não criada: ${p.why}.`); continue; }
      await tx.insert(automations).values({ tenantId: t, name: p.name, triggerType: p.triggerType, conditions: p.conditions, actionsJson: [p.action], isActive: true });
      notes.push(`"${p.name}" criada.`);
    }
    const stageName = (id?: string) => ss.find((s) => s.id === id)?.name;
    if (exec) notes.push(`Gatilho do Pós-Venda da consultoria: card chega em "${stageName(open(exec).at(-1)?.id)}".`);
    if (onb) notes.push(`Gatilho do Pós-Venda do CRM: card chega em "${stageName(open(onb).at(-1)?.id)}".`);
    return { notes };
  }),
{ minRole: "ADMIN" });
