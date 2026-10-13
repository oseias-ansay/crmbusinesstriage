"use client";
/**
 * Canais: conexões (números de WhatsApp, Instagram) e o ROTEAMENTO de cada uma —
 * em qual funil cai o lead novo e qual robô atende. Exceções por palavra-chave
 * (mensagem pré-preenchida ou título do anúncio) mandam para outro funil/robô.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Wand2 } from "lucide-react";
import { api } from "@/lib/fetcher";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Target = { pipelineId?: string; botFlowId?: string };
type Routing = Target & { rules?: (Target & { match: string })[] };
type Conn = { id: string; channel: string; name: string; externalId: string; isActive: boolean; config: { webhookToken?: string }; routing: Routing };
type Pipe = { id: string; name: string; isDefault: boolean };
type Bot = { id: string; name: string; isActive: boolean };

export function ChannelsPanel() {
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["channels"], queryFn: () => api<Conn[]>("/api/channels") });
  const { data: pipes = [] } = useQuery({ queryKey: ["pipelines"], queryFn: () => api<Pipe[]>("/api/pipelines") });
  const { data: bots = [] } = useQuery({ queryKey: ["bots"], queryFn: () => api<Bot[]>("/api/bots") });
  const add = useMutation({ mutationFn: (b: unknown) => api("/api/channels", { method: "POST", json: b }), onSuccess: () => qc.invalidateQueries({ queryKey: ["channels"] }) });

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate(Object.fromEntries(new FormData(e.currentTarget))); e.currentTarget.reset(); }}>
          <Select name="channel"><option value="WHATSAPP">WhatsApp (Evolution API)</option><option value="INSTAGRAM">Instagram Direct</option></Select>
          <Input name="name" placeholder="Nome (ex.: WhatsApp Venda de CRM)" required className="w-60" />
          <Input name="externalId" placeholder="Nome da instância / ID da página" required className="w-60" />
          <Input name="pageAccessToken" placeholder="Page token (Instagram)" className="w-56" />
          <Button type="submit">Conectar</Button>
        </form>
      </Card>
      {data.map((c) => <ConnCard key={c.id} c={c} pipes={pipes} bots={bots} />)}
    </div>
  );
}

function TargetFields({ value, onChange, pipes, bots, defaultsLabel }: { value: Target; onChange: (v: Target) => void; pipes: Pipe[]; bots: Bot[]; defaultsLabel: [string, string] }) {
  return (
    <>
      <Select className="w-full" value={value.pipelineId ?? ""} onChange={(e) => onChange({ ...value, pipelineId: e.target.value || undefined })}>
        <option value="">{defaultsLabel[0]}</option>
        {pipes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </Select>
      <Select className="w-full" value={value.botFlowId ?? ""} onChange={(e) => onChange({ ...value, botFlowId: e.target.value || undefined })}>
        <option value="">{defaultsLabel[1]}</option>
        <option value="none">Sem robô (atendimento humano)</option>
        {bots.map((b) => <option key={b.id} value={b.id}>{b.name}{b.isActive ? " (padrão)" : ""}</option>)}
      </Select>
    </>
  );
}

function ConnCard({ c, pipes, bots }: { c: Conn; pipes: Pipe[]; bots: Bot[] }) {
  const qc = useQueryClient();
  const [r, setR] = useState<Routing>(c.routing ?? {});
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setR(c.routing ?? {}), [c.routing]);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const done = (text: string) => { setMsg(text); qc.invalidateQueries({ queryKey: ["channels"] }); qc.invalidateQueries({ queryKey: ["pipelines"] }); qc.invalidateQueries({ queryKey: ["bots"] }); };
  const save = useMutation({
    mutationFn: () => api(`/api/channels/${c.id}`, { method: "PATCH", json: { routing: { ...r, rules: (r.rules ?? []).filter((x) => x.match.trim()) } } }),
    onSuccess: () => done("Roteamento salvo. Vale para os próximos leads novos deste número."),
    onError: (e: Error) => setMsg(e.message),
  });
  const crm = useMutation({
    mutationFn: () => api<{ notes: string[] }>("/api/bots/crm-sales-template", { method: "POST", json: { connectionId: c.id } }),
    onSuccess: (x) => done(x.notes.join(" ")),
    onError: (e: Error) => setMsg(e.message),
  });
  const rules = r.rules ?? [];
  const setRule = (i: number, v: Partial<Target & { match: string }>) => setR({ ...r, rules: rules.map((x, j) => (j === i ? { ...x, ...v } : x)) });
  const dirty = JSON.stringify(r) !== JSON.stringify(c.routing ?? {});

  return (
    <Card className="space-y-3 p-4 text-sm">
      <div>
        <p className="font-medium">{c.name} <Badge>{c.channel}</Badge></p>
        <p className="text-slate-500">Instância/ID: {c.externalId}</p>
        <p className="text-xs">Webhook: <code className="rounded bg-slate-100 px-1">{origin}/api/webhooks/{c.channel === "WHATSAPP" ? "whatsapp" : "instagram"}?token={c.config.webhookToken}</code></p>
      </div>

      <div className="rounded-lg bg-slate-50 p-3">
        <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Para onde vai o lead novo deste número</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div><Label>Funil de entrada</Label></div><div className="hidden sm:block"><Label>Robô que atende</Label></div>
          <TargetFields value={r} onChange={(v) => setR({ ...r, ...v })} pipes={pipes} bots={bots} defaultsLabel={["Funil padrão da empresa", "Robô padrão (o ativo)"]} />
        </div>

        <p className="mb-1 mt-4 text-xs font-semibold uppercase text-slate-500">Exceções por palavra-chave</p>
        <p className="mb-2 text-xs text-slate-500">
          Procuradas na 1ª mensagem do lead (use a mensagem pré-preenchida do anúncio), no título e no link do anúncio. Separe termos por vírgula; um número com 8+ dígitos é comparado ao ID do anúncio.
        </p>
        {rules.map((x, i) => (
          <div key={i} className="mb-2 grid items-center gap-2 sm:grid-cols-[1.2fr_1fr_1fr_auto]">
            <Input placeholder='ex.: "crm, sistema de vendas"' value={x.match} onChange={(e) => setRule(i, { match: e.target.value })} />
            <TargetFields value={x} onChange={(v) => setRule(i, v)} pipes={pipes} bots={bots} defaultsLabel={["(funil acima)", "(robô acima)"]} />
            <Button size="icon" variant="ghost" onClick={() => setR({ ...r, rules: rules.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button>
          </div>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setR({ ...r, rules: [...rules, { match: "" }] })}><Plus size={14} /> Adicionar exceção</Button>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
          <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>Salvar roteamento</Button>
          <Button size="sm" variant="outline" onClick={() => confirm(`Criar o funil "Venda de CRM" e o robô de qualificação de CRM e ligar a "${c.name}"?`) && crm.mutate()} disabled={crm.isPending}>
            <Wand2 size={14} /> Usar este número para Venda de CRM
          </Button>
          {msg && <span className="text-xs text-slate-600">{msg}</span>}
        </div>
      </div>
    </Card>
  );
}
