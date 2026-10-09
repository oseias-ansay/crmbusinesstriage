"use client";
/**
 * Editor de funis e etapas: criar/renomear/excluir funil, definir padrão,
 * criar/editar/reordenar/excluir etapas (com migração dos negócios).
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Bot, MessageCircle, Plus, Sparkles, Star, Trash2 } from "lucide-react";
import { META_EVENTS } from "@/lib/meta/events";
import { api } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";

type Stage = {
  id: string; name: string; color: string; order: number; probability: number; rottingDays: number | null; isWon: boolean; isLost: boolean;
  autoMessage: string | null; autoMessageDelayMin: number; aiCriteria: string | null; metaEvent: string | null;
};
type Pipeline = { id: string; name: string; isDefault: boolean; aiAutoMove: boolean; stages: Stage[] };

export function PipelinesPanel() {
  const qc = useQueryClient();
  const { data: pipelines = [] } = useQuery({ queryKey: ["pipelines"], queryFn: () => api<Pipeline[]>("/api/pipelines") });
  const [selId, setSelId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [deleting, setDeleting] = useState<Stage | null>(null);
  const p = pipelines.find((x) => x.id === selId) ?? pipelines[0];

  const refresh = () => {
    setError(null);
    qc.invalidateQueries({ queryKey: ["pipelines"] });
    qc.invalidateQueries({ queryKey: ["deals"] });
  };
  const onError = (e: Error) => setError(e.message);
  const call = useMutation({ mutationFn: (v: { url: string; method: string; json?: unknown }) => api(v.url, { method: v.method, json: v.json }), onSuccess: refresh, onError });

  if (!p) return <p className="text-sm text-slate-500">Carregando…</p>;

  function move(i: number, dir: -1 | 1) {
    const ids = p.stages.map((s) => s.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    call.mutate({ url: `/api/pipelines/${p.id}/stages`, method: "PUT", json: { order: ids } });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      <Card className="space-y-1 p-2">
        {pipelines.map((x) => (
          <button key={x.id} onClick={() => setSelId(x.id)} className={cn("flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm", x.id === p.id ? "bg-secondary/10 font-medium" : "hover:bg-slate-50")}>
            <span className="flex-1 truncate">{x.name}</span>
            {x.isDefault && <Star size={12} className="fill-amber-400 text-amber-400" aria-label="Padrão" />}
            <span className="text-xs text-slate-400">{x.stages.length}</span>
          </button>
        ))}
        <Button size="sm" variant="ghost" className="w-full" onClick={() => setNewOpen(true)}><Plus size={14} /> Novo funil</Button>
      </Card>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input key={p.id} defaultValue={p.name} className="max-w-xs font-medium" onBlur={(e) => e.target.value.trim() && e.target.value !== p.name && call.mutate({ url: `/api/pipelines/${p.id}`, method: "PATCH", json: { name: e.target.value.trim() } })} />
          {!p.isDefault ? (
            <Button size="sm" variant="outline" onClick={() => call.mutate({ url: `/api/pipelines/${p.id}`, method: "PATCH", json: { isDefault: true } })}><Star size={14} /> Tornar padrão</Button>
          ) : (
            <span className="text-xs text-slate-500">Funil padrão: novos leads do WhatsApp e do site entram aqui</span>
          )}
          <Button size="sm" variant="ghost" className="ml-auto text-red-600" onClick={() => confirm(`Excluir o funil "${p.name}"?`) && call.mutate({ url: `/api/pipelines/${p.id}`, method: "DELETE" })}><Trash2 size={14} /> Excluir funil</Button>
        </div>
        <label className="flex items-start gap-3 rounded-lg border bg-white p-3 text-sm">
          <input type="checkbox" className="mt-1" checked={p.aiAutoMove} onChange={(e) => call.mutate({ url: `/api/pipelines/${p.id}`, method: "PATCH", json: { aiAutoMove: e.target.checked } })} />
          <span>
            <span className="flex items-center gap-1 font-medium"><Sparkles size={14} className="text-secondary" /> IA move os cards deste funil</span>
            <span className="text-xs text-slate-500">
              Lê a conversa do WhatsApp ~1 min e meio depois da última mensagem do cliente e avança o card para a etapa certa, usando o critério de cada etapa.
              Nunca volta etapas e não marca Ganho/Perdido sozinha (só sugere ao responsável). Tudo fica na linha do tempo com o motivo.
            </span>
          </span>
        </label>
        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <Card className="divide-y">
          {p.stages.map((s, i) => (
            <StageRow key={s.id} stage={s} first={i === 0} last={i === p.stages.length - 1}
              onMove={(d) => move(i, d)}
              aiOn={p.aiAutoMove}
              onSave={(body) => call.mutate({ url: `/api/stages/${s.id}`, method: "PATCH", json: body })}
              onDelete={() => setDeleting(s)} />
          ))}
        </Card>
        <Button variant="outline" onClick={() => call.mutate({ url: `/api/pipelines/${p.id}/stages`, method: "POST", json: { name: "Nova etapa", color: "#94A3B8", probability: 50 } })}><Plus size={14} /> Adicionar etapa</Button>
        <p className="text-xs text-slate-500">
          <b>Probabilidade</b> alimenta o forecast ponderado do dashboard. <b>Alerta (dias)</b> destaca em amarelo os negócios parados há mais tempo na etapa.
          Marque <b>Ganho</b>/<b>Perdido</b> nas etapas finais — negócios movidos para elas são fechados automaticamente.
        </p>
      </div>

      <Dialog open={newOpen} onOpenChange={setNewOpen} title="Novo funil">
        <form className="grid gap-3" onSubmit={(e) => {
          e.preventDefault();
          const name = String(new FormData(e.currentTarget).get("name"));
          call.mutate({ url: "/api/pipelines", method: "POST", json: { name, stages: [
            { name: "Novo", color: "#94A3B8", probability: 10 }, { name: "Em andamento", color: "#38BDF8", probability: 50 },
            { name: "Ganho", color: "#10B981", probability: 100, isWon: true }, { name: "Perdido", color: "#EF4444", probability: 0, isLost: true },
          ] } }, { onSuccess: () => setNewOpen(false) });
        }}>
          <div><Label>Nome do funil</Label><Input name="name" required placeholder="Ex.: Pós-venda, Parcerias…" /></div>
          <p className="text-xs text-slate-500">O funil nasce com 4 etapas básicas, que você pode editar em seguida.</p>
          <Button type="submit">Criar</Button>
        </form>
      </Dialog>

      {deleting && (
        <Dialog open onOpenChange={(v) => !v && setDeleting(null)} title={`Excluir etapa "${deleting.name}"`}>
          <form className="grid gap-3" onSubmit={(e) => {
            e.preventDefault();
            const moveTo = String(new FormData(e.currentTarget).get("moveTo") ?? "");
            call.mutate({ url: `/api/stages/${deleting.id}${moveTo ? `?moveTo=${moveTo}` : ""}`, method: "DELETE" }, { onSuccess: () => setDeleting(null) });
          }}>
            <Label>Se houver negócios nesta etapa, mover para:</Label>
            <Select name="moveTo" className="w-full">
              {p.stages.filter((s) => s.id !== deleting.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            <Button type="submit" variant="danger">Excluir etapa</Button>
          </form>
        </Dialog>
      )}
    </div>
  );
}

function StageRow({ stage, first, last, aiOn, onMove, onSave, onDelete }: {
  stage: Stage; first: boolean; last: boolean; aiOn: boolean; onMove: (d: -1 | 1) => void; onSave: (b: Partial<Stage>) => void; onDelete: () => void;
}) {
  const [s, setS] = useState(stage);
  const [open, setOpen] = useState(false);
  useEffect(() => setS(stage), [stage]);
  const dirty = JSON.stringify(s) !== JSON.stringify(stage);
  const hasJourney = !!(stage.autoMessage || stage.aiCriteria || stage.metaEvent);
  return (
    <div className="p-3">
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-col">
        <button disabled={first} onClick={() => onMove(-1)} className="text-slate-400 hover:text-slate-700 disabled:opacity-20" aria-label="Subir"><ArrowUp size={14} /></button>
        <button disabled={last} onClick={() => onMove(1)} className="text-slate-400 hover:text-slate-700 disabled:opacity-20" aria-label="Descer"><ArrowDown size={14} /></button>
      </div>
      <input type="color" value={s.color} onChange={(e) => setS({ ...s, color: e.target.value.toUpperCase() })} className="h-8 w-9 cursor-pointer rounded border" />
      <Input value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} className="h-9 w-48" />
      <label className="flex items-center gap-1 text-xs text-slate-500">Prob.
        <Input type="number" min={0} max={100} value={s.probability} onChange={(e) => setS({ ...s, probability: Number(e.target.value) })} className="h-9 w-16" />%
      </label>
      <label className="flex items-center gap-1 text-xs text-slate-500">Alerta
        <Input type="number" min={1} value={s.rottingDays ?? ""} placeholder="—" onChange={(e) => setS({ ...s, rottingDays: e.target.value ? Number(e.target.value) : null })} className="h-9 w-16" />dias
      </label>
      <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={s.isWon} onChange={(e) => setS({ ...s, isWon: e.target.checked, isLost: e.target.checked ? false : s.isLost })} /> Ganho</label>
      <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={s.isLost} onChange={(e) => setS({ ...s, isLost: e.target.checked, isWon: e.target.checked ? false : s.isWon })} /> Perdido</label>
      <div className="ml-auto flex gap-1">
        <Button size="sm" variant={hasJourney ? "outline" : "ghost"} onClick={() => setOpen(!open)} title="Mensagem automática, critério da IA e evento da Meta">
          <MessageCircle size={14} /> Jornada{hasJourney && " •"}
        </Button>
        {dirty && (
          <Button size="sm" onClick={() => onSave({
            name: s.name, color: s.color, probability: s.probability, rottingDays: s.rottingDays, isWon: s.isWon, isLost: s.isLost,
            autoMessage: s.autoMessage?.trim() || null, autoMessageDelayMin: s.autoMessageDelayMin, aiCriteria: s.aiCriteria?.trim() || null, metaEvent: s.metaEvent || null,
          })}>Salvar</Button>
        )}
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onDelete} aria-label="Excluir etapa"><Trash2 size={14} /></Button>
      </div>
    </div>
    {open && (
      <div className="mt-3 grid gap-3 rounded-lg bg-slate-50 p-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <Label className="flex items-center gap-1"><MessageCircle size={13} /> Mensagem automática no WhatsApp ao entrar nesta etapa</Label>
          <Textarea rows={3} value={s.autoMessage ?? ""} placeholder="Ex.: Olá, {{contact.firstName}}! Recebemos seu pedido de diagnóstico…" onChange={(e) => setS({ ...s, autoMessage: e.target.value })} />
          <p className="mt-1 text-xs text-slate-500">
            Variáveis: {"{{contact.firstName}}"}, {"{{contact.name}}"}, {"{{deal.title}}"}, {"{{user.name}}"} (responsável), {"{{tenant.name}}"}. Vazio = não envia.
            Cada mensagem vai uma única vez por negócio.
          </p>
        </div>
        <div>
          <Label>Enviar depois de</Label>
          <div className="flex items-center gap-2 text-sm">
            <Input type="number" min={0} className="w-24" value={s.autoMessageDelayMin} onChange={(e) => setS({ ...s, autoMessageDelayMin: Math.max(0, Number(e.target.value)) })} /> minutos
          </div>
          <p className="mt-1 text-xs text-slate-500">Se o card sair da etapa antes disso, a mensagem é cancelada.</p>
        </div>
        <div>
          <Label>Evento enviado à Meta ao entrar</Label>
          <Select className="w-full" value={s.metaEvent ?? ""} onChange={(e) => setS({ ...s, metaEvent: e.target.value || null })}>
            <option value="">— nenhum —</option>
            {META_EVENTS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
          <p className="mt-1 text-xs text-slate-500">Lead e Purchase já são enviados automaticamente na criação e no ganho.</p>
        </div>
        <div className="md:col-span-2">
          <Label className="flex items-center gap-1"><Bot size={13} /> Critério para a IA colocar o card aqui {!aiOn && <span className="font-normal text-slate-400">(IA desligada neste funil)</span>}</Label>
          <Input value={s.aiCriteria ?? ""} placeholder="Ex.: o cliente pediu proposta ou perguntou preço" onChange={(e) => setS({ ...s, aiCriteria: e.target.value })} />
        </div>
      </div>
    )}
    </div>
  );
}
