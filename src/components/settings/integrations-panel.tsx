"use client";
/** Integrações: API de Conversões da Meta, IA (Anthropic) e dados da contratada (contratos). */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, Sparkles, Target, FileSignature } from "lucide-react";
import { api } from "@/lib/fetcher";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { GoogleCard } from "./google-card";

type S = {
  meta: { enabled?: boolean; datasetId?: string; accessToken?: string; testEventCode?: string; onlyAdLeads?: boolean; wabaId?: string; hasToken?: boolean };
  ai: { apiKey?: string; model?: string; dailyLimit?: number; minConfidence?: number; hasKey?: boolean; serverKey?: boolean };
  company: { razaoSocial?: string; cnpj?: string; endereco?: string; representante?: string; cpfRepresentante?: string; cidadeForo?: string };
};

export function IntegrationsPanel() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["tenant-settings"], queryFn: () => api<S>("/api/tenant/settings") });
  const [f, setF] = useState<S | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (data) setF(data); }, [data]);

  const save = useMutation({
    mutationFn: (part: Partial<S>) => api<S>("/api/tenant/settings", { method: "PATCH", json: part }),
    onSuccess: (d) => { qc.setQueryData(["tenant-settings"], d); setF(d); setMsg({ ok: true, text: "Salvo." }); },
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  });
  const test = useMutation({
    mutationFn: () => api<{ ok: boolean; status: number; resposta: unknown }>("/api/tracking/test", { method: "POST" }),
    onSuccess: (r) => setMsg({ ok: r.ok, text: r.ok ? "A Meta recebeu o evento de teste. Confira em Gerenciador de Eventos → Eventos de teste." : `A Meta recusou (${r.status}): ${JSON.stringify(r.resposta).slice(0, 300)}` }),
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  });

  if (!f) return <p className="text-sm text-slate-500">Carregando…</p>;
  const m = f.meta, a = f.ai, c = f.company;
  const setM = (p: Partial<S["meta"]>) => setF({ ...f, meta: { ...m, ...p } });
  const setA = (p: Partial<S["ai"]>) => setF({ ...f, ai: { ...a, ...p } });
  const setC = (p: Partial<S["company"]>) => setF({ ...f, company: { ...c, ...p } });

  return (
    <div className="space-y-4">
      {msg && <p className={`rounded-lg p-3 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}

      <Card className="space-y-3 p-5">
        <div className="flex items-center gap-2">
          <Target size={18} className="text-secondary" />
          <h2 className="font-semibold">Meta Ads — API de Conversões</h2>
          <label className="ml-auto flex items-center gap-2 text-sm"><input type="checkbox" checked={!!m.enabled} onChange={(e) => setM({ enabled: e.target.checked })} /> Ligada</label>
        </div>
        <p className="text-sm text-slate-600">
          O CRM identifica quem chegou por anúncio <b>Clique para WhatsApp</b> (e pelo site, com fbclid/UTM) e envia à Meta cada avanço da jornada:
          <b> Lead</b> ao entrar, os eventos que você marcar em cada etapa do funil e <b>Purchase</b> com o valor quando o negócio é ganho.
          Telefone, e-mail e nome vão criptografados (SHA-256), como a Meta exige.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <div><Label>ID do conjunto de dados (Pixel)</Label><Input value={m.datasetId ?? ""} onChange={(e) => setM({ datasetId: e.target.value.replace(/\D/g, "") })} placeholder="Ex.: 1234567890123456" /></div>
          <div><Label>Token de acesso da API de Conversões {m.hasToken && <CheckCircle2 size={12} className="inline text-emerald-600" />}</Label><Input value={m.accessToken ?? ""} onChange={(e) => setM({ accessToken: e.target.value })} placeholder="EAA…" /></div>
          <div><Label>Código de teste (opcional)</Label><Input value={m.testEventCode ?? ""} onChange={(e) => setM({ testEventCode: e.target.value })} placeholder="TEST12345" />
            <p className="mt-1 text-xs text-slate-500">Preenchido, todo evento vai como teste e <b>não</b> otimiza as campanhas. Apague depois de validar.</p></div>
          <div><Label>WhatsApp Business Account ID (opcional)</Label><Input value={m.wabaId ?? ""} onChange={(e) => setM({ wabaId: e.target.value })} placeholder="Só com a API oficial do WhatsApp" />
            <p className="mt-1 text-xs text-slate-500">Deixe vazio enquanto o número estiver na Evolution.</p></div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={m.onlyAdLeads ?? true} onChange={(e) => setM({ onlyAdLeads: e.target.checked })} /> Enviar só leads que vieram de anúncio (recomendado)</label>
        <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          LGPD: antes de ligar, a política de privacidade do site precisa informar que dados de contato são compartilhados, de forma criptografada, com plataformas de anúncio para medir campanhas.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => save.mutate({ meta: m })} disabled={save.isPending}>Salvar Meta</Button>
          <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending}>{test.isPending ? "Testando…" : "Enviar evento de teste"}</Button>
          <a className="ml-auto flex items-center gap-1 text-xs text-secondary underline" href="https://business.facebook.com/events_manager2" target="_blank" rel="noreferrer">Abrir Gerenciador de Eventos <ExternalLink size={12} /></a>
        </div>
      </Card>

      <GoogleCard />

      <Card className="space-y-3 p-5">
        <div className="flex items-center gap-2"><Sparkles size={18} className="text-secondary" /><h2 className="font-semibold">IA que move os cards</h2></div>
        <p className="text-sm text-slate-600">
          Usa o Claude (Anthropic) para ler as conversas e avançar os cards. Ligue por funil em <b>Funis</b> e escreva o critério de cada etapa em <b>Jornada</b>.
          {a.serverKey && !a.hasKey && " O servidor já tem uma chave configurada; preencha abaixo só se quiser usar outra."}
        </p>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="md:col-span-2"><Label>Chave da API Anthropic {a.hasKey && <CheckCircle2 size={12} className="inline text-emerald-600" />}</Label><Input value={a.apiKey ?? ""} onChange={(e) => setA({ apiKey: e.target.value })} placeholder={a.serverKey ? "usando a chave do servidor" : "sk-ant-…"} /></div>
          <div><Label>Análises por dia (limite)</Label><Input type="number" min={1} value={a.dailyLimit ?? 300} onChange={(e) => setA({ dailyLimit: Number(e.target.value) })} /></div>
          <div><Label>Confiança mínima</Label><Input type="number" step="0.05" min={0.3} max={1} value={a.minConfidence ?? 0.7} onChange={(e) => setA({ minConfidence: Number(e.target.value) })} /></div>
          <div className="md:col-span-2"><Label>Modelo</Label><Input value={a.model ?? ""} onChange={(e) => setA({ model: e.target.value })} placeholder="claude-haiku-4-5 (padrão: rápido e barato)" /></div>
        </div>
        <p className="text-xs text-slate-500">As últimas 30 mensagens da conversa são enviadas à Anthropic para análise; nada é guardado por ela para treino via API.</p>
        <Button onClick={() => save.mutate({ ai: a })} disabled={save.isPending}>Salvar IA</Button>
      </Card>

      <Card className="space-y-3 p-5">
        <div className="flex items-center gap-2"><FileSignature size={18} className="text-secondary" /><h2 className="font-semibold">Dados da contratada (para os contratos)</h2></div>
        <div className="grid gap-3 md:grid-cols-2">
          <div><Label>Razão social</Label><Input value={c.razaoSocial ?? ""} onChange={(e) => setC({ razaoSocial: e.target.value })} /></div>
          <div><Label>CNPJ</Label><Input value={c.cnpj ?? ""} onChange={(e) => setC({ cnpj: e.target.value })} /></div>
          <div className="md:col-span-2"><Label>Endereço completo</Label><Input value={c.endereco ?? ""} onChange={(e) => setC({ endereco: e.target.value })} /></div>
          <div><Label>Representante legal</Label><Input value={c.representante ?? ""} onChange={(e) => setC({ representante: e.target.value })} /></div>
          <div><Label>CPF do representante</Label><Input value={c.cpfRepresentante ?? ""} onChange={(e) => setC({ cpfRepresentante: e.target.value })} /></div>
          <div><Label>Cidade do foro</Label><Input value={c.cidadeForo ?? ""} onChange={(e) => setC({ cidadeForo: e.target.value })} placeholder="Curitiba/PR" /></div>
        </div>
        <Button onClick={() => save.mutate({ company: c })} disabled={save.isPending}>Salvar dados</Button>
      </Card>
    </div>
  );
}
