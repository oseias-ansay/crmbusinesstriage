"use client";
/**
 * Painel lateral com a visão 360° do negócio: dados, ganhar/perder,
 * linha do tempo, notas, tarefas, arquivos e histórico de etapas.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CheckCircle2, Circle, FileText, Paperclip, Pencil, ThumbsDown, Trophy } from "lucide-react";
import { EditDealForm } from "./edit-deal-form";
import Link from "next/link";
import { api } from "@/lib/fetcher";
import { useFieldDefs } from "@/components/forms/custom-fields";
import { brl, cn } from "@/lib/utils";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Deal360 = {
  id: string; title: string; value: string; status: "OPEN" | "WON" | "LOST"; recurring: boolean; createdAt: string; source: string | null;
  userId: string | null; expectedCloseAt: string | null; customFields: Record<string, unknown>;
  contact: { id: string; name: string; email: string | null; phone: string | null; organization: { name: string } | null; attribution?: { channel?: string; headline?: string; adId?: string; sourceUrl?: string; firstAt?: string } } | null;
  user: { name: string } | null; stage: { name: string; color: string }; pipeline: { id: string; name: string };
  lossReason: { name: string } | null; tags: { tag: { name: string; color: string } }[];
  tasks: { id: string; title: string; type: string; status: string; dueDate: string }[];
  notes: { id: string; content: string; createdAt: string; user: { name: string } | null }[];
  attachments: { id: string; fileName: string; url: string; sizeBytes: number }[];
  activities: { id: string; type: string; summary: string; createdAt: string }[];
  stageHistory: { id: string; createdAt: string; durationSec: number | null; fromStage: { name: string } | null; toStage: { name: string } }[];
  messages: { id: string; content: string; senderType: string; channel: string; timestamp: string }[];
};

const tabCls = "border-b-2 border-transparent px-3 py-2 text-sm text-slate-500 data-[state=active]:border-primary data-[state=active]:font-medium data-[state=active]:text-slate-900";

export function DealDrawer({ dealId, onClose }: { dealId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const key = ["deal", dealId];
  const { data: defs = [] } = useFieldDefs("DEAL");
  const fieldLabel = (k: string) => defs.find((f) => f.key === k)?.label ?? k.replace(/_/g, " ");
  const { data: d } = useQuery({ queryKey: key, queryFn: () => api<Deal360>(`/api/deals/${dealId}`), enabled: !!dealId });
  const [lossOpen, setLossOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["deals"] });
  };
  const patch = useMutation({ mutationFn: (body: unknown) => api(`/api/deals/${dealId}`, { method: "PATCH", json: body }), onSuccess: invalidate });
  const addNote = useMutation({
    mutationFn: () => api("/api/notes", { method: "POST", json: { content: note, dealId, contactId: d?.contact?.id } }),
    onSuccess: () => { setNote(""); invalidate(); },
  });
  const addTask = useMutation({ mutationFn: (body: unknown) => api("/api/tasks", { method: "POST", json: body }), onSuccess: invalidate });
  const toggleTask = useMutation({ mutationFn: (t: { id: string; status: string }) => api(`/api/tasks/${t.id}`, { method: "PATCH", json: { status: t.status === "DONE" ? "PENDING" : "DONE" } }), onSuccess: invalidate });

  async function upload(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("dealId", dealId!);
    if (d?.contact) fd.append("contactId", d.contact.id);
    await api("/api/upload", { method: "POST", body: fd });
    invalidate();
  }

  return (
    <Dialog open={!!dealId} onOpenChange={(v) => !v && onClose()} title={d?.title ?? "Carregando…"} side="right">
      {!d ? null : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge color={d.stage.color}>{d.pipeline.name} · {d.stage.name}</Badge>
            {d.status !== "OPEN" && <Badge color={d.status === "WON" ? "#10B981" : "#EF4444"}>{d.status === "WON" ? "Ganho" : `Perdido${d.lossReason ? `: ${d.lossReason.name}` : ""}`}</Badge>}
            {d.tags.map((t) => <Badge key={t.tag.name} color={t.tag.color}>{t.tag.name}</Badge>)}
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing((v) => !v)}><Pencil size={14} /> Editar</Button>
              {d.status === "OPEN" ? (
                <>
                  <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => patch.mutate({ status: "WON" })}><Trophy size={14} /> Ganho</Button>
                  <Button size="sm" variant="danger" onClick={() => setLossOpen(true)}><ThumbsDown size={14} /> Perdido</Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={() => patch.mutate({ status: "OPEN" })}>Reabrir</Button>
              )}
            </div>
          </div>

          {lossOpen && <LossForm onCancel={() => setLossOpen(false)} onConfirm={(lossReasonId, lossNote) => { patch.mutate({ status: "LOST", lossReasonId: lossReasonId || null, lossNote }); setLossOpen(false); }} />}

          {editing && <EditDealForm deal={d} onDone={() => { setEditing(false); invalidate(); }} />}

          <dl className="grid grid-cols-2 gap-4 rounded-xl bg-slate-50 p-4 text-sm">
            <div><dt className="text-xs text-slate-500">Valor</dt><dd className="text-lg font-semibold">{brl(d.value)}{d.recurring && <span className="text-xs font-normal text-slate-500"> /mês</span>}</dd></div>
            <div><dt className="text-xs text-slate-500">Responsável</dt><dd>{d.user?.name ?? "—"}</dd></div>
            <div>
              <dt className="text-xs text-slate-500">Contato</dt>
              <dd>{d.contact ? <Link className="text-primary underline" href={`/contacts/${d.contact.id}`}>{d.contact.name}</Link> : "—"}</dd>
              {d.contact?.phone && <dd className="text-xs text-slate-500">{d.contact.phone}</dd>}
              {d.contact?.email && <dd className="text-xs text-slate-500">{d.contact.email}</dd>}
            </div>
            <div><dt className="text-xs text-slate-500">Empresa / Origem</dt><dd>{d.contact?.organization?.name ?? "—"}</dd><dd className="text-xs text-slate-500">{d.source ?? ""}</dd>
              {d.contact?.attribution?.channel?.startsWith("meta") && (
                <dd className="mt-1 rounded bg-blue-50 px-2 py-1 text-xs text-blue-800" title={d.contact.attribution.adId ? `Anúncio ${d.contact.attribution.adId}` : undefined}>
                  📣 {d.contact.attribution.channel === "meta_ctwa" ? "Anúncio Clique para WhatsApp" : "Anúncio Meta (site)"}
                  {d.contact.attribution.headline && <>: <b>{d.contact.attribution.headline}</b></>}
                </dd>
              )}</div>
            {d.expectedCloseAt && <div><dt className="text-xs text-slate-500">Previsão de fechamento</dt><dd>{format(new Date(d.expectedCloseAt), "dd/MM/yyyy")}</dd></div>}
            {Object.entries(d.customFields ?? {}).filter(([, v]) => v != null && v !== "").map(([k, v]) => (
              <div key={k}><dt className="text-xs text-slate-500">{fieldLabel(k)}</dt><dd>{Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "Sim" : "Não") : String(v)}</dd></div>
            ))}
          </dl>

          <Tabs.Root defaultValue="timeline">
            <Tabs.List className="flex border-b">
              <Tabs.Trigger value="timeline" className={tabCls}>Linha do tempo</Tabs.Trigger>
              <Tabs.Trigger value="notes" className={tabCls}>Notas ({d.notes.length})</Tabs.Trigger>
              <Tabs.Trigger value="tasks" className={tabCls}>Tarefas ({d.tasks.filter((t) => t.status === "PENDING").length})</Tabs.Trigger>
              <Tabs.Trigger value="files" className={tabCls}>Arquivos ({d.attachments.length})</Tabs.Trigger>
              <Tabs.Trigger value="stages" className={tabCls}>Etapas</Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="timeline" className="pt-4">
              <ol className="relative space-y-4 border-l pl-5">
                {[...d.activities.map((a) => ({ id: a.id, at: a.createdAt, text: a.summary, kind: a.type })), ...d.messages.map((m) => ({ id: m.id, at: m.timestamp, text: m.content, kind: `${m.channel} · ${m.senderType === "CONTACT" ? "cliente" : "equipe"}` }))]
                  .sort((a, b) => +new Date(b.at) - +new Date(a.at))
                  .map((i) => (
                    <li key={i.id} className="relative">
                      <span className="absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full bg-secondary" />
                      <p className="text-sm">{i.text}</p>
                      <p className="text-[11px] text-slate-400">{i.kind} · {formatDistanceToNow(new Date(i.at), { locale: ptBR, addSuffix: true })}</p>
                    </li>
                  ))}
              </ol>
            </Tabs.Content>

            <Tabs.Content value="notes" className="space-y-3 pt-4">
              <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota interna (visível só para a equipe)…" />
              <Button size="sm" disabled={!note.trim() || addNote.isPending} onClick={() => addNote.mutate()}>Salvar nota</Button>
              {d.notes.map((n) => (
                <div key={n.id} className="rounded-lg border bg-amber-50/50 p-3 text-sm">
                  <p className="whitespace-pre-wrap">{n.content}</p>
                  <p className="mt-1 text-[11px] text-slate-400">{n.user?.name} · {format(new Date(n.createdAt), "dd/MM/yyyy HH:mm")}</p>
                </div>
              ))}
            </Tabs.Content>

            <Tabs.Content value="tasks" className="space-y-3 pt-4">
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
                  addTask.mutate({ title: f.title, type: f.type, dueDate: new Date(f.due).toISOString(), dealId, contactId: d.contact?.id });
                  e.currentTarget.reset();
                }}
              >
                <Input name="title" placeholder="Nova tarefa…" required />
                <Select name="type"><option value="CALL">Ligação</option><option value="MEETING">Reunião</option><option value="EMAIL">E-mail</option><option value="WHATSAPP">WhatsApp</option><option value="REMINDER">Lembrete</option></Select>
                <Input name="due" type="datetime-local" required className="w-52" />
                <Button size="sm" type="submit" className="h-10">Adicionar</Button>
              </form>
              {d.tasks.map((t) => {
                const overdue = t.status === "PENDING" && new Date(t.dueDate) < new Date();
                return (
                  <button key={t.id} onClick={() => toggleTask.mutate(t)} className="flex w-full items-center gap-3 rounded-lg border p-3 text-left text-sm hover:bg-slate-50">
                    {t.status === "DONE" ? <CheckCircle2 size={18} className="text-emerald-600" /> : <Circle size={18} className="text-slate-400" />}
                    <span className={cn("flex-1", t.status === "DONE" && "text-slate-400 line-through")}>{t.title}</span>
                    <span className={cn("text-xs", overdue ? "font-medium text-red-600" : "text-slate-500")}>{format(new Date(t.dueDate), "dd/MM HH:mm")}</span>
                  </button>
                );
              })}
            </Tabs.Content>

            <Tabs.Content value="files" className="space-y-3 pt-4">
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-sm text-slate-500 hover:bg-slate-50">
                <Paperclip size={16} /> Anexar arquivo
                <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              </label>
              {d.attachments.map((a) => (
                <a key={a.id} href={a.url} target="_blank" className="flex items-center gap-2 rounded-lg border p-3 text-sm hover:bg-slate-50">
                  <FileText size={16} /> {a.fileName} <span className="ml-auto text-xs text-slate-400">{(a.sizeBytes / 1024).toFixed(0)} KB</span>
                </a>
              ))}
            </Tabs.Content>

            <Tabs.Content value="stages" className="pt-4">
              <ul className="space-y-2 text-sm">
                {[...d.stageHistory].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).map((h) => (
                  <li key={h.id} className="flex justify-between rounded-lg border p-3">
                    <span>{h.fromStage ? `${h.fromStage.name} → ` : "Entrou em "}<b>{h.toStage.name}</b></span>
                    <span className="text-xs text-slate-500">
                      {format(new Date(h.createdAt), "dd/MM/yy HH:mm")}
                      {h.durationSec != null && ` · ${(h.durationSec / 86400).toFixed(1)}d na anterior`}
                    </span>
                  </li>
                ))}
              </ul>
            </Tabs.Content>
          </Tabs.Root>
        </div>
      )}
    </Dialog>
  );
}

function LossForm({ onConfirm, onCancel }: { onConfirm: (reasonId: string, note: string) => void; onCancel: () => void }) {
  const { data: reasons = [] } = useQuery({ queryKey: ["loss-reasons"], queryFn: () => api<{ id: string; name: string }[]>("/api/loss-reasons") });
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  return (
    <div className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-4">
      <p className="text-sm font-medium text-red-800">Por que este negócio foi perdido?</p>
      <Select className="w-full" value={reason} onChange={(e) => setReason(e.target.value)}>
        <option value="">Selecione o motivo…</option>
        {reasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </Select>
      <Input placeholder="Observação (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex gap-2">
        <Button size="sm" variant="danger" disabled={!reason} onClick={() => onConfirm(reason, note)}>Confirmar perda</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
      </div>
    </div>
  );
}
