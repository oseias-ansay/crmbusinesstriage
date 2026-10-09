"use client";
/** Conexão com o Google Agenda da empresa (agendamentos do robô). */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CheckCircle2, Copy } from "lucide-react";
import { api } from "@/lib/fetcher";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";

type G = { clientId: string; hasSecret: boolean; connected: boolean; email: string | null; calendarId: string; calendarName: string | null; createMeet: boolean; inviteContact: boolean; redirectUri: string };

export function GoogleCard() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["google"], queryFn: () => api<G>("/api/integrations/google") });
  const { data: cals = [] } = useQuery({ queryKey: ["google-cals"], queryFn: () => api<{ id: string; name: string; primary: boolean }[]>("/api/integrations/google/calendars"), enabled: !!data?.connected, retry: false });
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (data) setClientId(data.clientId); }, [data]);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("google");
    if (p) setMsg(p === "ok" ? { ok: true, text: "Google Agenda conectado." } : { ok: false, text: p });
  }, []);

  const refresh = () => { qc.invalidateQueries({ queryKey: ["google"] }); qc.invalidateQueries({ queryKey: ["google-cals"] }); };
  const save = useMutation({ mutationFn: (b: Record<string, unknown>) => api("/api/integrations/google", { method: "PATCH", json: b }), onSuccess: () => { refresh(); setSecret(""); setMsg({ ok: true, text: "Salvo." }); }, onError: (e: Error) => setMsg({ ok: false, text: e.message }) });
  const off = useMutation({ mutationFn: () => api("/api/integrations/google", { method: "DELETE" }), onSuccess: refresh });

  if (!data) return null;
  return (
    <Card className="space-y-3 p-5">
      <div className="flex items-center gap-2">
        <CalendarDays size={18} className="text-secondary" />
        <h2 className="font-semibold">Google Agenda</h2>
        {data.connected && <span className="ml-auto flex items-center gap-1 text-sm text-emerald-700"><CheckCircle2 size={14} /> conectado {data.email && `(${data.email})`}</span>}
      </div>
      <p className="text-sm text-slate-600">
        Cada atendimento agendado pelo robô vira um evento no calendário da empresa, com link do Google Meet próprio. Os horários oferecidos
        descontam o que já está ocupado no calendário.
      </p>
      {msg && <p className={`rounded-lg p-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}

      <div className="grid gap-3 md:grid-cols-2">
        <div><Label>Client ID (Google Cloud)</Label><Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="…apps.googleusercontent.com" /></div>
        <div><Label>Client Secret {data.hasSecret && <CheckCircle2 size={12} className="inline text-emerald-600" />}</Label><Input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={data.hasSecret ? "•••• (mantido)" : "GOCSPX-…"} /></div>
      </div>
      <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-2 text-xs">
        <span className="text-slate-500">URI de redirecionamento autorizado:</span>
        <code className="flex-1 truncate">{data.redirectUri}</code>
        <button className="flex items-center gap-1 text-secondary" onClick={() => navigator.clipboard.writeText(data.redirectUri)}><Copy size={12} /> copiar</button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => save.mutate({ clientId, ...(secret && { clientSecret: secret }) })} disabled={save.isPending}>Salvar credenciais</Button>
        <a href="/api/integrations/google/connect"><Button disabled={!clientId || (!data.hasSecret && !secret)}>{data.connected ? "Reconectar" : "Conectar Google Agenda"}</Button></a>
        {data.connected && <Button variant="ghost" className="text-red-600" onClick={() => confirm("Desconectar o Google Agenda? Os agendamentos continuam no CRM.") && off.mutate()}>Desconectar</Button>}
      </div>

      {data.connected && (
        <div className="grid gap-3 border-t pt-3 md:grid-cols-3">
          <div className="md:col-span-1">
            <Label>Calendário dos agendamentos</Label>
            <Select className="w-full" value={data.calendarId} onChange={(e) => save.mutate({ calendarId: e.target.value, calendarName: cals.find((c) => c.id === e.target.value)?.name })}>
              {!cals.some((c) => c.id === data.calendarId) && <option value={data.calendarId}>{data.calendarName ?? "Principal"}</option>}
              {cals.map((c) => <option key={c.id} value={c.id}>{c.name}{c.primary ? " (principal)" : ""}</option>)}
            </Select>
          </div>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={data.createMeet} onChange={(e) => save.mutate({ createMeet: e.target.checked })} /> Criar link do Google Meet</label>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={data.inviteContact} onChange={(e) => save.mutate({ inviteContact: e.target.checked })} /> Enviar convite ao lead (se tiver e-mail)</label>
        </div>
      )}
    </Card>
  );
}
