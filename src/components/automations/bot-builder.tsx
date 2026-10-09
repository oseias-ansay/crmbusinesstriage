"use client";
/**
 * Construtor visual do robô de triagem/qualificação.
 * Fluxo em blocos encadeados (cada bloco aponta para o próximo; "Condição"
 * tem saída SIM/NÃO). Inclui simulador para testar antes de ativar.
 * Evolução natural: trocar a lista por um canvas com @xyflow/react mantendo o mesmo JSON.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, Bot, CalendarClock, Filter, Radio, GitBranch, Hand, MessageSquare, MousePointerClick, Play, Plus, Save, Sparkles, Trash2, Wrench, HelpCircle } from "lucide-react";
import { api } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import { DEFAULT_HOURS, END, NODE_LABELS, evaluateQualify, offHours, type BotFlowDef, type BotNode, type LiveData, type QualifyData, type ScheduleData } from "@/lib/bot/types";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

type BotRow = { id: string; name: string; channel: string; isActive: boolean; flow: BotFlowDef };
const ICONS: Record<BotNode["type"], typeof Bot> = { message: MessageSquare, question: HelpCircle, choice: MousePointerClick, condition: GitBranch, action: Wrench, handoff: Hand, qualify: Filter, schedule: CalendarClock, live: Radio };
const uid = () => `n${Math.random().toString(36).slice(2, 7)}`;

function blank(type: BotNode["type"]): BotNode {
  const id = uid();
  switch (type) {
    case "message": return { id, type, data: { text: "" } };
    case "question": return { id, type, data: { text: "", variable: "resposta" } };
    case "choice": return { id, type, data: { text: "", variable: "opcao", options: ["Opção 1", "Opção 2"] } };
    case "condition": return { id, type, data: { variable: "", equals: "" } };
    case "action": return { id, type, data: { action: "ADD_TAG", value: "" } };
    case "handoff": return { id, type, data: { text: "Vou te transferir para um especialista.", offHoursText: "Nosso time atende de segunda a sexta, das 9h às 17h. Um especialista vai falar com você {{atendimento.quando}}, a partir das 9h.", hours: DEFAULT_HOURS } };
    case "qualify": return { id, type, data: { rules: [], followUpDays: 90 } };
    case "schedule": return { id, type, data: { intro: "Estes são os próximos horários livres para um atendimento de 30 minutos, online. Responda com o número:", confirmText: "Agendado ✅ {{agendamento.data}} (30 min, online). {{agendamento.linkTexto}} Se precisar remarcar, é só responder aqui.", durationMin: 30, slots: 4, minLeadMin: 120, daysAhead: 7, reminderMin: 60, hours: DEFAULT_HOURS }, else: undefined };
    case "live": return { id, type, data: { intro: "Estas são as próximas lives. Responda com o número da que você quer participar:", confirmText: "Inscrição confirmada ✅ \"{{live.titulo}}\", {{live.data}}. Vou te lembrar na véspera e mandar o link 30 minutos antes.", noLivesText: "Ainda não temos live marcada. Assim que tiver, te aviso por aqui.", max: 3 } };
  }
}

export function BotBuilder({ stages }: { stages: { id: string; label: string }[] }) {
  const qc = useQueryClient();
  const { data: users = [] } = useQuery({ queryKey: ["users"], queryFn: () => api<{ id: string; name: string; isActive: boolean }[]>("/api/users") });
  const [tplMsg, setTplMsg] = useState<string | null>(null);
  const template = useMutation({
    mutationFn: (b: { disableWelcomeWhatsapp: boolean }) => api<{ botId: string; notes: string[] }>("/api/bots/qualification-template", { method: "POST", json: b }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["bots"] }); qc.invalidateQueries({ queryKey: ["pipelines"] }); qc.invalidateQueries({ queryKey: ["automations"] }); setSelId(r.botId); setTplMsg(r.notes.join(" ")); },
    onError: (e: Error) => setTplMsg(e.message),
  });
  const { data: bots = [] } = useQuery({ queryKey: ["bots"], queryFn: () => api<BotRow[]>("/api/bots") });
  const [selId, setSelId] = useState<string | null>(null);
  const bot = bots.find((b) => b.id === selId) ?? bots[0];
  const [nodes, setNodes] = useState<BotNode[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (bot) setNodes(bot.flow.nodes ?? []);
  }, [bot]);

  const save = useMutation({
    mutationFn: (body: Partial<BotRow>) => api(`/api/bots/${bot!.id}`, { method: "PATCH", json: body }),
    onSuccess: () => { setError(null); qc.invalidateQueries({ queryKey: ["bots"] }); },
    onError: (e: Error) => setError(e.message),
  });
  const create = useMutation({ mutationFn: () => api<BotRow>("/api/bots", { method: "POST", json: { name: "Novo robô" } }), onSuccess: (b) => { qc.invalidateQueries({ queryKey: ["bots"] }); setSelId(b.id); } });

  // Garante encadeamento linear padrão: cada nó sem "next" aponta para o seguinte
  function normalized(): BotFlowDef {
    const ns = nodes.map((n, i) => (n.type !== "handoff" && !("next" in n && n.next) && nodes[i + 1] ? { ...n, next: nodes[i + 1].id } : n)) as BotNode[];
    return { startNodeId: ns[0]?.id ?? "", nodes: ns };
  }

  const update = (i: number, patch: Partial<BotNode> & { data?: Record<string, unknown> }) =>
    setNodes((prev) => prev.map((n, j) => (j === i ? ({ ...n, ...patch, data: { ...n.data, ...(patch.data ?? {}) } } as BotNode) : n)));

  const tplButton = (
    <Button size="sm" variant="outline" className="w-full" disabled={template.isPending}
      onClick={() => confirm("Criar o robô de qualificação (4 perguntas) e o funil Nutrição?\n\nA mensagem de boas-vindas anterior (WhatsApp da automação de novo lead) será substituída pela abertura do robô. Tarefas e atribuição da automação continuam.") && template.mutate({ disableWelcomeWhatsapp: true })}>
      <Sparkles size={14} /> Robô de qualificação (modelo)
    </Button>
  );

  if (!bot) return <div className="flex max-w-md flex-col gap-2"><Button onClick={() => create.mutate()}><Plus size={16} /> Criar primeiro robô</Button>{tplButton}{tplMsg && <p className="text-sm text-slate-600">{tplMsg}</p>}</div>;

  return (
    <div className="grid gap-4 xl:grid-cols-[220px_1fr_340px]">
      <Card className="space-y-1 p-2">
        {bots.map((b) => (
          <button key={b.id} onClick={() => setSelId(b.id)} className={cn("flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm", b.id === bot.id ? "bg-secondary/10 font-medium" : "hover:bg-slate-50")}>
            <Bot size={14} /> <span className="flex-1 truncate">{b.name}</span>
            {b.isActive && <span className="h-2 w-2 rounded-full bg-emerald-500" title="Ativo" />}
          </button>
        ))}
        <Button size="sm" variant="ghost" className="w-full" onClick={() => create.mutate()}><Plus size={14} /> Novo robô</Button>
        {tplButton}
        {tplMsg && <p className="px-1 text-xs text-slate-600">{tplMsg}</p>}
      </Card>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input className="max-w-xs font-medium" defaultValue={bot.name} key={bot.id} onBlur={(e) => e.target.value !== bot.name && save.mutate({ name: e.target.value })} />
          <span className="text-xs text-slate-500">{bot.channel}</span>
          <label className="ml-auto flex items-center gap-2 text-sm">
            <input type="checkbox" checked={bot.isActive} onChange={(e) => save.mutate({ isActive: e.target.checked })} /> Ativo
          </label>
          <Button size="sm" onClick={() => save.mutate({ flow: normalized() })}><Save size={14} /> Salvar fluxo</Button>
        </div>
        {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}

        {nodes.map((n, i) => {
          const Icon = ICONS[n.type];
          return (
            <div key={n.id}>
              {i > 0 && <ArrowDown size={16} className="mx-auto my-1 text-slate-300" />}
              <Card className={cn("p-4", i === 0 && "ring-2 ring-secondary/40")}>
                <div className="mb-2 flex items-center gap-2">
                  <Icon size={16} className="text-secondary" />
                  <p className="text-sm font-semibold">{NODE_LABELS[n.type]}</p>
                  <code className="text-[10px] text-slate-400">{n.id}</code>
                  {i === 0 && <span className="text-[10px] font-semibold uppercase text-secondary">início</span>}
                  <Button size="icon" variant="ghost" className="ml-auto h-7 w-7" onClick={() => setNodes(nodes.filter((_, j) => j !== i))}><Trash2 size={14} /></Button>
                </div>

                {(n.type === "message" || n.type === "question" || n.type === "choice" || n.type === "handoff") && (
                  <Textarea rows={2} placeholder="Texto enviado ao contato (aceita {{contact.name}} e variáveis coletadas)" value={n.data.text ?? ""} onChange={(e) => update(i, { data: { text: e.target.value } })} />
                )}
                {(n.type === "question" || n.type === "choice") && (
                  <div className="mt-2"><Label>Salvar resposta na variável</Label><Input value={n.data.variable} onChange={(e) => update(i, { data: { variable: e.target.value.replace(/\W/g, "_") } })} /></div>
                )}
                {n.type === "choice" && (
                  <div className="mt-2"><Label>Opções (uma por linha)</Label><Textarea rows={3} value={n.data.options.join("\n")} onChange={(e) => update(i, { data: { options: e.target.value.split("\n") } })} /></div>
                )}
                {n.type === "condition" && (
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label>Se a variável</Label><Input value={n.data.variable} onChange={(e) => update(i, { data: { variable: e.target.value } })} /></div>
                    <div><Label>for igual a</Label><Input value={n.data.equals} onChange={(e) => update(i, { data: { equals: e.target.value } })} /></div>
                    <div><Label>SIM → ir para</Label><Select className="w-full" value={n.next ?? ""} onChange={(e) => update(i, { next: e.target.value || undefined })}><option value="">próximo bloco</option>{nodes.filter((x) => x.id !== n.id).map((x) => <option key={x.id} value={x.id}>{x.id} · {NODE_LABELS[x.type]}</option>)}</Select></div>
                    <div><Label>NÃO → ir para</Label><Select className="w-full" value={n.else ?? ""} onChange={(e) => update(i, { else: e.target.value || undefined } as Partial<BotNode>)}><option value="">encerrar</option>{nodes.filter((x) => x.id !== n.id).map((x) => <option key={x.id} value={x.id}>{x.id} · {NODE_LABELS[x.type]}</option>)}</Select></div>
                  </div>
                )}
                {n.type === "action" && (
                  <div className="grid grid-cols-2 gap-2">
                    <Select value={n.data.action} onChange={(e) => update(i, { data: { action: e.target.value } })}><option value="ADD_TAG">Adicionar tag</option><option value="MOVE_STAGE">Mover etapa</option><option value="SET_FIELD">Preencher campo</option></Select>
                    {n.data.action === "MOVE_STAGE" ? (
                      <Select value={n.data.value} onChange={(e) => update(i, { data: { value: e.target.value } })}><option value="">Etapa…</option>{stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>
                    ) : (
                      <Input placeholder={n.data.action === "SET_FIELD" ? "valor ({{empresa}})" : "nome da tag"} value={n.data.value} onChange={(e) => update(i, { data: { value: e.target.value } })} />
                    )}
                    {n.data.action === "SET_FIELD" && <Input placeholder="chave do campo" value={n.data.field ?? ""} onChange={(e) => update(i, { data: { field: e.target.value } })} />}
                  </div>
                )}
                {n.type === "handoff" && (
                  <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      Expediente (Brasília, segunda a sexta, sem feriados nacionais): das
                      <Input type="time" className="h-8 w-28" value={n.data.hours?.start ?? DEFAULT_HOURS.start} onChange={(e) => update(i, { data: { hours: { ...DEFAULT_HOURS, ...n.data.hours, start: e.target.value } } })} />
                      às
                      <Input type="time" className="h-8 w-28" value={n.data.hours?.end ?? DEFAULT_HOURS.end} onChange={(e) => update(i, { data: { hours: { ...DEFAULT_HOURS, ...n.data.hours, end: e.target.value } } })} />
                    </div>
                    <Label>Mensagem fora do horário (vazio = usa a mensagem acima)</Label>
                    <Textarea rows={3} value={n.data.offHoursText ?? ""} onChange={(e) => update(i, { data: { offHoursText: e.target.value } })} />
                    <p className="text-xs text-slate-500">{"{{atendimento.quando}}"} vira o próximo dia útil: “hoje”, “amanhã” ou “na segunda-feira (13/10)”.</p>
                    <div className="flex items-center gap-2 text-xs">Feriados locais (DD/MM, separados por vírgula)
                      <Input className="h-8 w-48" placeholder="08/09, 20/01" value={(n.data.hours?.extraHolidays ?? []).map((x) => x.split("-").reverse().join("/")).join(", ")}
                        onChange={(e) => update(i, { data: { hours: { ...DEFAULT_HOURS, ...n.data.hours, extraHolidays: e.target.value.split(",").map((x) => x.trim()).filter((x) => /^\d{2}\/\d{2}$/.test(x)).map((x) => x.split("/").reverse().join("-")) } } })} />
                    </div>
                  </div>
                )}
                {n.type === "qualify" && (
                  <QualifyEditor data={n.data} nodes={nodes} stages={stages} users={users.filter((u) => u.isActive)} onChange={(data) => update(i, { data })}
                    yes={n.next} no={n.else} onRoute={(k, v) => update(i, { [k]: v || undefined } as Partial<BotNode>)} />
                )}
                {n.type === "schedule" && <ScheduleEditor data={n.data} stages={stages} users={users.filter((u) => u.isActive)} nodes={nodes} self={n.id} yes={n.next} no={n.else} onChange={(data) => update(i, { data })} onRoute={(k, v) => update(i, { [k]: v || undefined } as Partial<BotNode>)} />}
                {n.type === "live" && <LiveEditor data={n.data} nodes={nodes} self={n.id} yes={n.next} no={n.else} onChange={(data) => update(i, { data })} onRoute={(k, v) => update(i, { [k]: v || undefined } as Partial<BotNode>)} />}
                {n.type !== "condition" && n.type !== "handoff" && n.type !== "qualify" && n.type !== "schedule" && n.type !== "live" && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                    depois →
                    <Select className="h-8 text-xs" value={n.next ?? ""} onChange={(e) => update(i, { next: e.target.value || undefined })}>
                      <option value="">próximo bloco</option>
                      <option value={END}>encerrar</option>
                      {nodes.filter((x) => x.id !== n.id).map((x) => <option key={x.id} value={x.id}>{x.id} · {NODE_LABELS[x.type]}</option>)}
                    </Select>
                  </div>
                )}
              </Card>
            </div>
          );
        })}

        <div className="flex flex-wrap gap-2 pt-2">
          {(Object.keys(NODE_LABELS) as BotNode["type"][]).map((t) => (
            <Button key={t} size="sm" variant="outline" onClick={() => setNodes([...nodes, blank(t)])}><Plus size={12} /> {NODE_LABELS[t]}</Button>
          ))}
        </div>
      </div>

      <Simulator flow={normalized()} />
    </div>
  );
}

/** Simulador local do fluxo (mesma lógica do motor do servidor, sem efeitos no CRM). */
function Simulator({ flow }: { flow: BotFlowDef }) {
  const [log, setLog] = useState<{ from: "bot" | "user"; text: string }[]>([]);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [vars, setVars] = useState<Record<string, string>>({});
  const [input, setInput] = useState("");
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const fill = (t: string, v: Record<string, string>) => t.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k: string) => (k === "contact.name" ? "Cliente Teste" : k === "contact.firstName" ? "Cliente" : v[k] ?? ""));

  function run(startId: string | undefined, v: Record<string, string>, acc: { from: "bot" | "user"; text: string }[]) {
    let node = startId ? byId.get(startId) : undefined;
    let wait: string | null = null;
    for (let s = 0; node && s < 25; s++) {
      if (node.type === "message") { acc.push({ from: "bot", text: fill(node.data.text, v) }); node = node.next ? byId.get(node.next) : undefined; }
      else if (node.type === "question") { acc.push({ from: "bot", text: fill(node.data.text, v) }); wait = node.id; break; }
      else if (node.type === "choice") { acc.push({ from: "bot", text: `${fill(node.data.text, v)}\n${node.data.options.map((o, i) => `${i + 1}. ${o}`).join("\n")}` }); wait = node.id; break; }
      else if (node.type === "condition") { const ok = (v[node.data.variable] ?? "").toLowerCase() === node.data.equals.toLowerCase(); const nx: string | undefined = ok ? node.next : node.else; node = nx ? byId.get(nx) : undefined; }
      else if (node.type === "action") { acc.push({ from: "bot", text: `⚙ ação: ${node.data.action} = ${fill(node.data.value, v)}` }); node = node.next ? byId.get(node.next) : undefined; }
      else if (node.type === "schedule" || node.type === "live") {
        const items = node.type === "schedule" ? ["(1º horário livre)", "(2º horário livre)", "(3º horário livre)", "(4º horário livre)", "Nenhum desses horários"] : ["(próxima live)", "(live seguinte)", "Agora não, obrigado"];
        acc.push({ from: "bot", text: `${fill(node.data.intro, v)}\n${items.map((t, i) => `${i + 1}. ${t}`).join("\n")}` });
        wait = node.id; break;
      }
      else if (node.type === "qualify") {
        const r = evaluateQualify(node.data, v);
        acc.push({ from: "bot", text: r.qualified ? `✅ qualificado${r.tier ? ` · ${r.tier}` : ""} → etapa de qualificação` : `❌ não qualificado (${r.failed.join(", ")}) → Nutrição` });
        const nx: string | undefined = r.qualified ? node.next : node.else;
        node = nx ? byId.get(nx) : undefined;
      }
      else if (node.type === "handoff") {
        const oh = offHours(new Date(), node.data.hours);
        const t = oh.off && node.data.offHoursText ? node.data.offHoursText : node.data.text;
        if (t) acc.push({ from: "bot", text: fill(t, { ...v, "atendimento.quando": oh.quando, "atendimento.inicio": oh.inicio }) });
        acc.push({ from: "bot", text: `👤 transferido para atendente${oh.off ? " (fora do horário agora)" : ""}` });
        node = undefined;
      }
    }
    setWaiting(wait);
    setLog([...acc]);
  }

  function start() { setVars({}); setWaiting(null); run(flow.startNodeId, {}, []); }

  function answer() {
    if (!waiting || !input.trim()) return;
    const node = byId.get(waiting)!;
    const acc = [...log, { from: "user" as const, text: input }];
    if (node.type === "schedule" || node.type === "live") {
      const max = node.type === "schedule" ? 5 : 3;
      const n = Number(input.trim());
      setInput(""); setWaiting(null);
      if (!n || n < 1 || n > max) { acc.push({ from: "bot", text: "Responda com o número de uma opção." }); setLog(acc); setWaiting(node.id); return; }
      if (n === max) { run(node.else, vars, acc); return; }
      const conf = node.type === "schedule"
        ? fill(node.data.confirmText.replace("{{agendamento.data}}", "quinta-feira, 09/10, às 10h").replace("{{agendamento.linkTexto}}", node.data.meetingLink ? `Link da videochamada: ${node.data.meetingLink}` : "O link da videochamada será enviado antes do horário."), vars)
        : fill(node.data.confirmText.replace("{{live.titulo}}", "Live de exemplo").replace("{{live.data}}", "terça-feira, 14/10, às 19h"), vars);
      acc.push({ from: "bot", text: conf });
      run(node.next, vars, acc);
      return;
    }
    let value = input.trim();
    if (node.type === "choice") {
      const match = node.data.options[Number(value) - 1] ?? node.data.options.find((o) => o.toLowerCase() === value.toLowerCase());
      if (!match) { acc.push({ from: "bot", text: "Responda com o número de uma opção." }); setLog(acc); setInput(""); return; }
      value = match;
    }
    const v = { ...vars, [(node as { data: { variable: string } }).data.variable]: value };
    setVars(v); setInput(""); setWaiting(null);
    run((node as { next?: string }).next, v, acc);
  }

  return (
    <Card className="flex h-[560px] flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <p className="text-sm font-semibold">Simulador</p>
        <Button size="sm" variant="outline" onClick={start}><Play size={12} /> Testar</Button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto bg-[#efeae2] p-3">
        {log.map((m, i) => (
          <div key={i} className={cn("max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm shadow-sm", m.from === "bot" ? "bg-white" : "ml-auto bg-[#d9fdd3]")}>{m.text}</div>
        ))}
      </div>
      <div className="flex gap-2 border-t p-2">
        <Input value={input} disabled={!waiting} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && answer()} placeholder={waiting ? "Responder como cliente…" : "Clique em Testar"} />
        <Button size="sm" className="h-10" onClick={answer} disabled={!waiting}>Enviar</Button>
      </div>
      {Object.keys(vars).length > 0 && <pre className="border-t bg-slate-50 p-2 text-[11px]">{JSON.stringify(vars, null, 1)}</pre>}
    </Card>
  );
}

/** Editor do bloco "Qualificar lead": regras (todas precisam passar), porte e destino do card. */
function QualifyEditor({ data, nodes, stages, users, onChange, yes, no, onRoute }: {
  data: QualifyData; nodes: BotNode[]; stages: { id: string; label: string }[]; users: { id: string; name: string }[];
  onChange: (d: QualifyData) => void; yes?: string; no?: string; onRoute: (k: "next" | "else", v: string) => void;
}) {
  const choices = nodes.filter((x): x is Extract<BotNode, { type: "choice" }> => x.type === "choice");
  const optionsOf = (variable: string) => choices.find((c) => c.data.variable === variable)?.data.options ?? [];
  const tierOpts = data.tier ? optionsOf(data.tier.variable) : [];
  const tiers = [...new Set(Object.values(data.tier?.map ?? {}).filter(Boolean))];
  const set = (p: Partial<QualifyData>) => onChange({ ...data, ...p });
  const others = nodes.filter((x) => x.data !== data);
  return (
    <div className="space-y-3 text-sm">
      <div>
        <Label>Qualificado se TODAS as respostas abaixo forem aceitas</Label>
        {data.rules.map((r, k) => (
          <div key={k} className="mt-1 rounded-lg border p-2">
            <div className="flex items-center gap-2">
              <Select className="h-8 text-xs" value={r.variable} onChange={(e) => set({ rules: data.rules.map((x, j) => (j === k ? { variable: e.target.value, accept: [] } : x)) })}>
                <option value="">pergunta…</option>
                {choices.map((c) => <option key={c.id} value={c.data.variable}>{c.data.variable}</option>)}
              </Select>
              <button className="ml-auto text-xs text-red-600" onClick={() => set({ rules: data.rules.filter((_, j) => j !== k) })}>remover</button>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
              {optionsOf(r.variable).map((o) => (
                <label key={o} className="flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={r.accept.includes(o)} onChange={(e) => set({ rules: data.rules.map((x, j) => (j === k ? { ...x, accept: e.target.checked ? [...x.accept, o] : x.accept.filter((y) => y !== o) } : x)) })} /> {o}
                </label>
              ))}
            </div>
          </div>
        ))}
        <Button size="sm" variant="ghost" onClick={() => set({ rules: [...data.rules, { variable: "", accept: [] }] })}><Plus size={12} /> regra</Button>
      </div>
      <div className="rounded-lg border p-2">
        <Label>Porte (não exclui): pergunta</Label>
        <Select className="h-8 text-xs" value={data.tier?.variable ?? ""} onChange={(e) => set({ tier: e.target.value ? { variable: e.target.value, map: {} } : undefined })}>
          <option value="">— sem porte —</option>
          {choices.map((c) => <option key={c.id} value={c.data.variable}>{c.data.variable}</option>)}
        </Select>
        {tierOpts.map((o) => (
          <div key={o} className="mt-1 flex items-center gap-2 text-xs"><span className="flex-1">{o}</span>
            <Input className="h-8 w-28 text-xs" value={data.tier?.map[o] ?? ""} placeholder="tag (Porte 1)" onChange={(e) => set({ tier: { variable: data.tier!.variable, map: { ...data.tier!.map, [o]: e.target.value } } })} /></div>
        ))}
        {tiers.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            Responsável fixo para
            {tiers.map((t) => <label key={t} className="flex items-center gap-1"><input type="checkbox" checked={data.priorityTiers?.includes(t) ?? false} onChange={(e) => set({ priorityTiers: e.target.checked ? [...(data.priorityTiers ?? []), t] : (data.priorityTiers ?? []).filter((x) => x !== t) })} />{t}</label>)}
            <Select className="h-8 text-xs" value={data.priorityUserId ?? ""} onChange={(e) => set({ priorityUserId: e.target.value || undefined })}>
              <option value="">— rodízio —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </div>
        )}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <div><Label>Qualificado: card vai para</Label><Select className="w-full" value={data.qualifiedStageId ?? ""} onChange={(e) => set({ qualifiedStageId: e.target.value || undefined })}><option value="">não mover</option>{stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></div>
        <div><Label>Não qualificado: card vai para</Label><Select className="w-full" value={data.nurtureStageId ?? ""} onChange={(e) => set({ nurtureStageId: e.target.value || undefined })}><option value="">não mover</option>{stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></div>
        <div><Label>Qualificado → ir para</Label><Select className="w-full" value={yes ?? END} onChange={(e) => onRoute("next", e.target.value)}><option value={END}>encerrar</option>{others.map((x) => <option key={x.id} value={x.id}>{x.id} · {NODE_LABELS[x.type]}</option>)}</Select></div>
        <div><Label>Não qualificado → ir para</Label><Select className="w-full" value={no ?? END} onChange={(e) => onRoute("else", e.target.value)}><option value={END}>encerrar</option>{others.map((x) => <option key={x.id} value={x.id}>{x.id} · {NODE_LABELS[x.type]}</option>)}</Select></div>
        <div><Label>Retomar o não qualificado em (dias)</Label><Input type="number" min={0} value={data.followUpDays ?? 90} onChange={(e) => set({ followUpDays: Number(e.target.value) })} /></div>
      </div>
      <p className="text-xs text-slate-500">Qualificado: tags Qualificado + porte, evento QualifiedLead para a Meta. Não qualificado: tag Não qualificado, sai da fila de atendimento e ganha uma tarefa de retomada.</p>
    </div>
  );
}

function Route({ label, value, nodes, self, onChange }: { label: string; value?: string; nodes: BotNode[]; self: string; onChange: (v: string) => void }) {
  return (
    <div><Label>{label}</Label>
      <Select className="w-full" value={value ?? END} onChange={(e) => onChange(e.target.value)}>
        <option value={END}>encerrar</option>
        {nodes.filter((x) => x.id !== self).map((x) => <option key={x.id} value={x.id}>{x.id} · {NODE_LABELS[x.type]}</option>)}
      </Select>
    </div>
  );
}

/** Editor do bloco "Agendar atendimento". */
function ScheduleEditor({ data, stages, users, nodes, self, yes, no, onChange, onRoute }: {
  data: ScheduleData; stages: { id: string; label: string }[]; users: { id: string; name: string }[]; nodes: BotNode[]; self: string; yes?: string; no?: string;
  onChange: (d: ScheduleData) => void; onRoute: (k: "next" | "else", v: string) => void;
}) {
  const set = (p: Partial<ScheduleData>) => onChange({ ...data, ...p });
  const num = (k: keyof ScheduleData, label: string, def: number) => (
    <div><Label>{label}</Label><Input type="number" min={1} value={(data[k] as number | undefined) ?? def} onChange={(e) => set({ [k]: Number(e.target.value) } as Partial<ScheduleData>)} /></div>
  );
  return (
    <div className="space-y-2 text-sm">
      <div><Label>Texto antes dos horários</Label><Textarea rows={2} value={data.intro} onChange={(e) => set({ intro: e.target.value })} /></div>
      <div><Label>Confirmação ({"{{agendamento.data}}"}, {"{{agendamento.linkTexto}}"})</Label><Textarea rows={2} value={data.confirmText} onChange={(e) => set({ confirmText: e.target.value })} /></div>
      <div className="grid gap-2 md:grid-cols-5">
        {num("durationMin", "Duração (min)", 30)}{num("slots", "Horários oferecidos", 4)}{num("minLeadMin", "Antecedência (min)", 120)}{num("daysAhead", "Dias úteis à frente", 7)}{num("reminderMin", "Lembrete (min antes)", 60)}
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        <div><Label>Link fixo da videochamada</Label><Input value={data.meetingLink ?? ""} placeholder="https://meet.google.com/…" onChange={(e) => set({ meetingLink: e.target.value || undefined })} /></div>
        <div><Label>Card vai para</Label><Select className="w-full" value={data.stageId ?? ""} onChange={(e) => set({ stageId: e.target.value || undefined })}><option value="">não mover</option>{stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></div>
        <div><Label>Quem atende</Label><Select className="w-full" value={data.userId ?? ""} onChange={(e) => set({ userId: e.target.value || undefined })}><option value="">responsável do negócio</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">Expediente: das
        <Input type="time" className="h-8 w-28" value={data.hours?.start ?? DEFAULT_HOURS.start} onChange={(e) => set({ hours: { ...DEFAULT_HOURS, ...data.hours, start: e.target.value } })} /> às
        <Input type="time" className="h-8 w-28" value={data.hours?.end ?? DEFAULT_HOURS.end} onChange={(e) => set({ hours: { ...DEFAULT_HOURS, ...data.hours, end: e.target.value } })} />
        (seg–sex, sem feriados; horários já ocupados na agenda de quem atende são pulados)
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <Route label="Agendou → ir para" value={yes} nodes={nodes} self={self} onChange={(v) => onRoute("next", v)} />
        <Route label="Nenhum horário serve → ir para" value={no} nodes={nodes} self={self} onChange={(v) => onRoute("else", v)} />
      </div>
    </div>
  );
}

/** Editor do bloco "Inscrever em live". */
function LiveEditor({ data, nodes, self, yes, no, onChange, onRoute }: {
  data: LiveData; nodes: BotNode[]; self: string; yes?: string; no?: string; onChange: (d: LiveData) => void; onRoute: (k: "next" | "else", v: string) => void;
}) {
  const set = (p: Partial<LiveData>) => onChange({ ...data, ...p });
  return (
    <div className="space-y-2 text-sm">
      <div><Label>Texto antes das lives</Label><Textarea rows={2} value={data.intro} onChange={(e) => set({ intro: e.target.value })} /></div>
      <div><Label>Confirmação ({"{{live.titulo}}"}, {"{{live.data}}"}, {"{{live.link}}"})</Label><Textarea rows={2} value={data.confirmText} onChange={(e) => set({ confirmText: e.target.value })} /></div>
      <div><Label>Quando não houver live marcada</Label><Textarea rows={2} value={data.noLivesText ?? ""} onChange={(e) => set({ noLivesText: e.target.value })} /></div>
      <div className="grid gap-2 md:grid-cols-3">
        <div><Label>Lives listadas</Label><Input type="number" min={1} max={5} value={data.max ?? 3} onChange={(e) => set({ max: Number(e.target.value) })} /></div>
        <Route label="Inscreveu → ir para" value={yes} nodes={nodes} self={self} onChange={(v) => onRoute("next", v)} />
        <Route label="Recusou / sem live → ir para" value={no} nodes={nodes} self={self} onChange={(v) => onRoute("else", v)} />
      </div>
      <p className="text-xs text-slate-500">As lives são cadastradas na aba Lives. Lembretes automáticos: na véspera e 30 minutos antes, com o link.</p>
    </div>
  );
}
