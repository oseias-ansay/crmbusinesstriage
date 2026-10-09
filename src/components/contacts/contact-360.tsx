"use client";
/** Visão 360° do contato: dados + campos personalizados, negócios, tarefas, notas, arquivos e linha do tempo unificada. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { EditContactDialog } from "./edit-contact-dialog";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Mail, MessageCircle, Pencil, Phone } from "lucide-react";
import { api } from "@/lib/fetcher";
import { useFieldDefs } from "@/components/forms/custom-fields";
import { brl } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type C360 = {
  id: string; name: string; email: string | null; phone: string | null; instagram: string | null; jobTitle: string | null; source: string | null; createdAt: string;
  customFields: Record<string, unknown>; organization: { name: string } | null; owner: { id: string; name: string } | null;
  tags: { tag: { name: string; color: string } }[];
  deals: { id: string; title: string; value: string; status: string; stage: { name: string; color: string }; pipeline: { name: string } }[];
  tasks: { id: string; title: string; status: string; dueDate: string; user: { name: string } }[];
  notes: { id: string; content: string; createdAt: string; user: { name: string } | null }[];
  attachments: { id: string; fileName: string; url: string }[];
  timeline: { kind: "activity" | "message"; at: string; type: string; text: string; from?: string }[];
};

export function Contact360({ id }: { id: string }) {
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const { data: defs = [] } = useFieldDefs("CONTACT");
  const fieldLabel = (k: string) => defs.find((f) => f.key === k)?.label ?? k.replace(/_/g, " ");
  const { data: c } = useQuery({ queryKey: ["contact", id], queryFn: () => api<C360>(`/api/contacts/${id}`) });
  if (!c) return <p className="p-6 text-sm text-slate-500">Carregando…</p>;

  return (
    <div className="grid gap-6 p-6 xl:grid-cols-[340px_1fr]">
      <div className="space-y-4">
        <Card>
          <CardContent className="text-center">
            <Avatar name={c.name} size={72} className="mx-auto" />
            <h1 className="mt-3 text-lg font-semibold">{c.name}</h1>
            <p className="text-sm text-slate-500">{[c.jobTitle, c.organization?.name].filter(Boolean).join(" · ")}</p>
            <div className="mt-3 flex flex-wrap justify-center gap-1">{c.tags.map((t) => <Badge key={t.tag.name} color={t.tag.color}>{t.tag.name}</Badge>)}</div>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => setEditOpen(true)}><Pencil size={14} /> Editar contato</Button>
            <EditContactDialog key={editOpen ? "o" : "c"} contact={c} open={editOpen} onOpenChange={setEditOpen} onSaved={() => qc.invalidateQueries({ queryKey: ["contact", id] })} />
            <div className="mt-4 space-y-1 text-left text-sm">
              {c.phone && <a href={`https://wa.me/${c.phone}`} target="_blank" className="flex items-center gap-2 hover:underline"><MessageCircle size={14} className="text-emerald-600" /> {c.phone}</a>}
              {c.phone && <a href={`tel:+${c.phone}`} className="flex items-center gap-2 hover:underline"><Phone size={14} /> Ligar</a>}
              {c.email && <a href={`mailto:${c.email}`} className="flex items-center gap-2 hover:underline"><Mail size={14} /> {c.email}</a>}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Dados</CardTitle></CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Responsável</dt><dd>{c.owner?.name ?? "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Origem</dt><dd>{c.source ?? "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Desde</dt><dd>{format(new Date(c.createdAt), "dd/MM/yyyy")}</dd></div>
              {Object.entries(c.customFields ?? {}).filter(([, v]) => v != null && v !== "").map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4"><dt className="text-slate-500">{fieldLabel(k)}</dt><dd className="text-right">{Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "Sim" : "Não") : String(v)}</dd></div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Negócios ({c.deals.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {c.deals.map((d) => (
              <Link key={d.id} href={`/pipeline?deal=${d.id}`} className="block rounded-lg border p-3 hover:bg-slate-50">
                <p className="text-sm font-medium">{d.title}</p>
                <div className="mt-1 flex items-center justify-between"><Badge color={d.stage.color}>{d.pipeline.name} · {d.stage.name}</Badge><span className="text-sm font-semibold">{brl(d.value)}</span></div>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Tarefas pendentes</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {c.tasks.filter((t) => t.status === "PENDING").map((t) => (
                <div key={t.id} className="flex justify-between"><span>{t.title}</span><span className={new Date(t.dueDate) < new Date() ? "text-red-600" : "text-slate-500"}>{format(new Date(t.dueDate), "dd/MM HH:mm")}</span></div>
              ))}
              {!c.tasks.some((t) => t.status === "PENDING") && <p className="text-slate-500">Nenhuma.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Arquivos</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              {c.attachments.map((a) => <a key={a.id} href={a.url} target="_blank" className="block truncate text-primary underline">{a.fileName}</a>)}
              {c.attachments.length === 0 && <p className="text-slate-500">Nenhum arquivo.</p>}
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader><CardTitle>Notas internas</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {c.notes.map((n) => (
              <div key={n.id} className="rounded-lg bg-amber-50/60 p-3 text-sm"><p>{n.content}</p><p className="mt-1 text-[11px] text-slate-400">{n.user?.name} · {format(new Date(n.createdAt), "dd/MM/yyyy HH:mm")}</p></div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Linha do tempo</CardTitle></CardHeader>
          <CardContent>
            <ol className="relative space-y-4 border-l pl-5">
              {c.timeline.map((i, idx) => (
                <li key={idx} className="relative">
                  <span className={`absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full ${i.kind === "message" ? "bg-emerald-500" : "bg-secondary"}`} />
                  <p className="text-sm">{i.kind === "message" && <b>{i.from === "CONTACT" ? `${c.name.split(" ")[0]}: ` : "Equipe: "}</b>}{i.text}</p>
                  <p className="text-[11px] text-slate-400">{i.type} · {formatDistanceToNow(new Date(i.at), { locale: ptBR, addSuffix: true })}</p>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
