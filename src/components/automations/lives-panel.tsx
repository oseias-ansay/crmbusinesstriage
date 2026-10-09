"use client";
/** Cadastro das lives que o robô oferece + lista de inscritos. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Plus, Trash2, Users } from "lucide-react";
import { api } from "@/lib/fetcher";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

type Live = { id: string; title: string; description: string | null; startsAt: string; durationMin: number; link: string | null; isActive: boolean; inscritos: number };
type Reg = { id: string; name: string; phone: string | null; email: string | null; createdAt: string; contactId: string };

export function LivesPanel() {
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["lives"], queryFn: () => api<Live[]>("/api/lives") });
  const [editing, setEditing] = useState<Partial<Live> | null>(null);
  const [regsOf, setRegsOf] = useState<Live | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const done = () => { setErr(null); setEditing(null); qc.invalidateQueries({ queryKey: ["lives"] }); };
  const save = useMutation({
    mutationFn: (l: Partial<Live>) => api(l.id ? `/api/lives/${l.id}` : "/api/lives", { method: l.id ? "PATCH" : "POST", json: l }),
    onSuccess: done,
    onError: (e: Error) => setErr(e.message),
  });
  const del = useMutation({ mutationFn: (id: string) => api(`/api/lives/${id}`, { method: "DELETE" }), onSuccess: done });
  const toggle = useMutation({ mutationFn: (l: Live) => api(`/api/lives/${l.id}`, { method: "PATCH", json: { isActive: !l.isActive } }), onSuccess: done });
  const now = Date.now();

  return (
    <div className="space-y-3">
      <div className="flex items-center">
        <p className="mr-auto text-sm text-slate-600">O robô oferece as próximas lives ativas (até 3) e manda lembrete na véspera e 30 minutos antes, com o link.</p>
        <Button onClick={() => setEditing({ durationMin: 60, isActive: true })}><Plus size={14} /> Nova live</Button>
      </div>
      <Card className="divide-y">
        {data.map((l) => {
          const past = new Date(l.startsAt).getTime() < now;
          return (
            <div key={l.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{l.title} {past ? <Badge color="#94A3B8">realizada</Badge> : l.isActive ? <Badge color="#10B981">ativa</Badge> : <Badge color="#F59E0B">pausada</Badge>}</p>
                <p className="text-xs text-slate-500">{format(new Date(l.startsAt), "EEEE, dd/MM 'às' HH:mm", { locale: ptBR })} · {l.durationMin} min{l.link ? ` · ${l.link}` : " · sem link"}</p>
              </div>
              <button className="flex items-center gap-1 text-xs text-secondary hover:underline" onClick={() => setRegsOf(l)}><Users size={13} /> {l.inscritos} inscrito(s)</button>
              {!past && <Button size="sm" variant="ghost" onClick={() => toggle.mutate(l)}>{l.isActive ? "Pausar" : "Ativar"}</Button>}
              <Button size="sm" variant="outline" onClick={() => setEditing({ ...l, startsAt: format(new Date(l.startsAt), "yyyy-MM-dd'T'HH:mm") })}>Editar</Button>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-red-600" onClick={() => confirm(`Excluir "${l.title}"? Os inscritos deixam de receber lembretes.`) && del.mutate(l.id)}><Trash2 size={14} /></Button>
            </div>
          );
        })}
        {!data.length && <p className="p-6 text-center text-sm text-slate-400">Nenhuma live cadastrada. Sem live, o robô avisa o lead que vai chamá-lo quando houver.</p>}
      </Card>

      {editing && (
        <Dialog open onOpenChange={(v) => !v && setEditing(null)} title={editing.id ? "Editar live" : "Nova live"}>
          <form className="grid gap-3" onSubmit={(e) => {
            e.preventDefault();
            const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
            save.mutate({ ...(editing.id && { id: editing.id }), title: f.title, description: f.description || null, startsAt: new Date(f.startsAt).toISOString(), durationMin: Number(f.durationMin), link: f.link || null, isActive: editing.isActive ?? true });
          }}>
            <div><Label>Título</Label><Input name="title" required defaultValue={editing.title} placeholder="Por que o dinheiro some do caixa" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Data e hora (seu horário)</Label><Input name="startsAt" type="datetime-local" required defaultValue={editing.startsAt} /></div>
              <div><Label>Duração (min)</Label><Input name="durationMin" type="number" min={10} defaultValue={editing.durationMin ?? 60} /></div>
            </div>
            <div><Label>Link (YouTube, Meet, Zoom…)</Label><Input name="link" type="url" defaultValue={editing.link ?? ""} placeholder="https://" /></div>
            <div><Label>Descrição (opcional)</Label><Textarea name="description" rows={2} defaultValue={editing.description ?? ""} /></div>
            {err && <p className="text-sm text-red-600">{err}</p>}
            <Button type="submit" disabled={save.isPending}>Salvar</Button>
          </form>
        </Dialog>
      )}
      {regsOf && <Registrants live={regsOf} onClose={() => setRegsOf(null)} />}
    </div>
  );
}

function Registrants({ live, onClose }: { live: Live; onClose: () => void }) {
  const { data = [] } = useQuery({ queryKey: ["live-regs", live.id], queryFn: () => api<Reg[]>(`/api/lives/${live.id}`) });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={`Inscritos — ${live.title}`}>
      <ul className="divide-y text-sm">
        {data.map((r) => (
          <li key={r.id} className="flex items-center gap-2 py-2">
            <a className="font-medium hover:underline" href={`/contacts/${r.contactId}`}>{r.name}</a>
            <span className="text-xs text-slate-500">{r.phone ?? r.email ?? ""}</span>
            <span className="ml-auto text-xs text-slate-400">{format(new Date(r.createdAt), "dd/MM HH:mm")}</span>
          </li>
        ))}
        {!data.length && <li className="py-4 text-center text-slate-400">Ninguém inscrito ainda.</li>}
      </ul>
    </Dialog>
  );
}
