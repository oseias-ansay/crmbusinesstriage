"use client";
/**
 * Motor de Automação (Digital Pipeline) + Bot Builder.
 * Aba 1: regras "QUANDO <gatilho> [SE condição] ENTÃO <ações>"
 * Aba 2: construtor visual do robô de triagem
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Tabs from "@radix-ui/react-tabs";
import { ArrowDown, Plus, Power, Trash2, Zap } from "lucide-react";
import { api } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { BotBuilder } from "./bot-builder";
import { LivesPanel } from "./lives-panel";

type Action = { type: string; params: Record<string, string | number>; delayMinutes?: number };
type Automation = { id: string; name: string; triggerType: string; conditions: Record<string, string>; actionsJson: Action[]; isActive: boolean; runCount: number; logs: { status: string; createdAt: string }[] };
type Pipeline = { id: string; name: string; stages: { id: string; name: string }[] };

export const TRIGGERS: Record<string, string> = {
  DEAL_CREATED: "Lead/negócio criado",
  DEAL_STAGE_CHANGED: "Negócio mudou de etapa",
  DEAL_WON: "Negócio ganho",
  DEAL_LOST: "Negócio perdido",
  TAG_ADDED: "Tag adicionada",
  FORM_SUBMITTED: "Formulário preenchido",
  MESSAGE_RECEIVED: "Mensagem recebida",
  TASK_OVERDUE: "Tarefa vencida",
};
const ACTIONS: Record<string, { label: string; fields: { key: string; label: string; textarea?: boolean; type?: string }[] }> = {
  SEND_WHATSAPP: { label: "Enviar WhatsApp", fields: [{ key: "text", label: "Mensagem (aceita {{contact.name}}, {{deal.title}}, {{user.name}})", textarea: true }] },
  SEND_EMAIL: { label: "Enviar e-mail", fields: [{ key: "subject", label: "Assunto" }, { key: "body", label: "Corpo (HTML)", textarea: true }] },
  CREATE_TASK: { label: "Criar tarefa", fields: [{ key: "title", label: "Título" }, { key: "taskType", label: "Tipo (CALL, MEETING, EMAIL, WHATSAPP)" }, { key: "dueInHours", label: "Prazo (horas)", type: "number" }] },
  ASSIGN_USER: { label: "Reatribuir responsável", fields: [{ key: "strategy", label: "Estratégia (ROUND_ROBIN) ou deixe vazio e informe userId" }, { key: "userId", label: "userId fixo (opcional)" }] },
  ADD_TAG: { label: "Adicionar tag", fields: [{ key: "tag", label: "Tag" }] },
  MOVE_STAGE: { label: "Mover para etapa", fields: [{ key: "stageId", label: "Etapa" }] },
  WEBHOOK: { label: "Chamar webhook (n8n/Make)", fields: [{ key: "url", label: "URL" }] },
};

export function AutomationsView() {
  const qc = useQueryClient();
  const { data: list = [] } = useQuery({ queryKey: ["automations"], queryFn: () => api<Automation[]>("/api/automations") });
  const { data: pipelines = [] } = useQuery({ queryKey: ["pipelines"], queryFn: () => api<Pipeline[]>("/api/pipelines") });
  const [editing, setEditing] = useState<Partial<Automation> | null>(null);
  const allStages = pipelines.flatMap((p) => p.stages.map((s) => ({ ...s, label: `${p.name} › ${s.name}` })));

  const toggle = useMutation({
    mutationFn: (a: Automation) => api(`/api/automations/${a.id}`, { method: "PATCH", json: { isActive: !a.isActive } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["automations"] }),
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/api/automations/${id}`, { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["automations"] }) });
  const save = useMutation({
    mutationFn: (a: Partial<Automation>) =>
      a.id ? api(`/api/automations/${a.id}`, { method: "PATCH", json: a }) : api("/api/automations", { method: "POST", json: a }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["automations"] }); setEditing(null); },
  });

  const tabCls = "rounded-md px-4 py-1.5 text-sm data-[state=active]:bg-white data-[state=active]:font-medium data-[state=active]:shadow-sm";

  return (
    <div className="space-y-4 p-6">
      <Tabs.Root defaultValue="rules">
        <div className="flex items-center gap-3">
          <h1 className="mr-auto text-xl font-semibold">Automações</h1>
          <Tabs.List className="flex rounded-lg bg-slate-100 p-1">
            <Tabs.Trigger value="rules" className={tabCls}>Regras</Tabs.Trigger>
            <Tabs.Trigger value="bots" className={tabCls}>Bot Builder</Tabs.Trigger>
            <Tabs.Trigger value="lives" className={tabCls}>Lives</Tabs.Trigger>
          </Tabs.List>
        </div>

        <Tabs.Content value="rules" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button onClick={() => setEditing({ name: "", triggerType: "DEAL_CREATED", conditions: {}, actionsJson: [{ type: "SEND_WHATSAPP", params: { text: "" } }], isActive: true })}>
              <Plus size={16} /> Nova automação
            </Button>
          </div>
          {list.map((a) => (
            <Card key={a.id} className={cn("flex items-center gap-4 p-4", !a.isActive && "opacity-60")}>
              <span className="rounded-lg bg-secondary/10 p-2 text-secondary"><Zap size={18} /></span>
              <button className="flex-1 text-left" onClick={() => setEditing(a)}>
                <p className="font-medium">{a.name}</p>
                <p className="text-xs text-slate-500">
                  Quando <b>{TRIGGERS[a.triggerType]}</b>
                  {a.conditions.stageId && <> em <b>{allStages.find((s) => s.id === a.conditions.stageId)?.label}</b></>}
                  {a.conditions.tagName && <> com tag <b>{a.conditions.tagName}</b></>} → {a.actionsJson.map((x) => ACTIONS[x.type]?.label).join(", ")}
                </p>
              </button>
              <Badge>{a.runCount} execuções</Badge>
              {a.logs[0] && <Badge color={a.logs[0].status === "SUCCESS" ? "#10B981" : "#EF4444"}>último: {a.logs[0].status}</Badge>}
              <Button size="icon" variant="ghost" onClick={() => toggle.mutate(a)} aria-label="Ativar/desativar"><Power size={16} className={a.isActive ? "text-emerald-600" : ""} /></Button>
              <Button size="icon" variant="ghost" onClick={() => remove.mutate(a.id)} aria-label="Excluir"><Trash2 size={16} /></Button>
            </Card>
          ))}
        </Tabs.Content>

        <Tabs.Content value="lives" className="mt-4">
          <LivesPanel />
        </Tabs.Content>
        <Tabs.Content value="bots" className="mt-4">
          <BotBuilder stages={allStages} />
        </Tabs.Content>
      </Tabs.Root>

      {editing && (
        <Dialog open onOpenChange={(v) => !v && setEditing(null)} title={editing.id ? "Editar automação" : "Nova automação"} className="max-w-2xl">
          <div className="space-y-4">
            <div><Label>Nome</Label><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
            <div className="rounded-xl border bg-slate-50 p-4">
              <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Quando (gatilho)</p>
              <Select className="w-full" value={editing.triggerType} onChange={(e) => setEditing({ ...editing, triggerType: e.target.value })}>
                {Object.entries(TRIGGERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
              {editing.triggerType === "DEAL_STAGE_CHANGED" && (
                <div className="mt-2"><Label>Etapa de destino</Label>
                  <Select className="w-full" value={editing.conditions?.stageId ?? ""} onChange={(e) => setEditing({ ...editing, conditions: { ...editing.conditions, stageId: e.target.value } })}>
                    <option value="">Qualquer etapa</option>{allStages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </Select>
                </div>
              )}
              {editing.triggerType === "TAG_ADDED" && (
                <div className="mt-2"><Label>Nome da tag</Label><Input value={editing.conditions?.tagName ?? ""} onChange={(e) => setEditing({ ...editing, conditions: { ...editing.conditions, tagName: e.target.value } })} /></div>
              )}
              {editing.triggerType === "FORM_SUBMITTED" && (
                <div className="mt-2"><Label>ID do formulário (vazio = qualquer)</Label><Input value={editing.conditions?.formId ?? ""} onChange={(e) => setEditing({ ...editing, conditions: { ...editing.conditions, formId: e.target.value } })} /></div>
              )}
            </div>
            {editing.actionsJson?.map((act, i) => (
              <div key={i}>
                <ArrowDown size={16} className="mx-auto mb-2 text-slate-400" />
                <div className="space-y-2 rounded-xl border p-4">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold uppercase text-slate-500">Então</p>
                    <Select className="flex-1" value={act.type} onChange={(e) => { const a = [...editing.actionsJson!]; a[i] = { type: e.target.value, params: {} }; setEditing({ ...editing, actionsJson: a }); }}>
                      {Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </Select>
                    <Input type="number" min={0} className="w-28" placeholder="atraso min" value={act.delayMinutes ?? ""} onChange={(e) => { const a = [...editing.actionsJson!]; a[i] = { ...act, delayMinutes: Number(e.target.value) || 0 }; setEditing({ ...editing, actionsJson: a }); }} />
                    <Button size="icon" variant="ghost" onClick={() => setEditing({ ...editing, actionsJson: editing.actionsJson!.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button>
                  </div>
                  {ACTIONS[act.type]?.fields.map((f) => {
                    const set = (v: string) => { const a = [...editing.actionsJson!]; a[i] = { ...act, params: { ...act.params, [f.key]: f.type === "number" ? Number(v) : v } }; setEditing({ ...editing, actionsJson: a }); };
                    if (f.key === "stageId") return <Select key={f.key} className="w-full" value={String(act.params.stageId ?? "")} onChange={(e) => set(e.target.value)}><option value="">Selecione…</option>{allStages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>;
                    return (
                      <div key={f.key}><Label>{f.label}</Label>
                        {f.textarea ? <Textarea rows={3} value={String(act.params[f.key] ?? "")} onChange={(e) => set(e.target.value)} /> : <Input type={f.type} value={String(act.params[f.key] ?? "")} onChange={(e) => set(e.target.value)} />}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <Button variant="outline" className="w-full" onClick={() => setEditing({ ...editing, actionsJson: [...(editing.actionsJson ?? []), { type: "CREATE_TASK", params: { title: "", dueInHours: 24 } }] })}><Plus size={14} /> Adicionar ação</Button>
            {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
            <Button className="w-full" onClick={() => save.mutate({ id: editing.id, name: editing.name, triggerType: editing.triggerType, conditions: Object.fromEntries(Object.entries(editing.conditions ?? {}).filter(([, v]) => v)), actionsJson: editing.actionsJson, isActive: editing.isActive })}>Salvar automação</Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
