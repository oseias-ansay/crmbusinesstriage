"use client";
/** Tarefas: visão Lista (agrupada por prazo) e Calendário (mensal/semanal). */
import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addDays, addMonths, addWeeks, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, isToday, startOfMonth, startOfWeek, subMonths, subWeeks,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Circle, List, Mail, MessageCircle, Phone, Plus, Users, Bell } from "lucide-react";
import { api } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import { useSocketEvent } from "@/hooks/useSocket";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";

type Task = { id: string; title: string; description: string | null; type: string; status: "PENDING" | "DONE" | "CANCELED"; dueDate: string; userName: string; dealTitle: string | null; contactName: string | null; dealId: string | null };
const ICON: Record<string, typeof Phone> = { CALL: Phone, MEETING: Users, EMAIL: Mail, WHATSAPP: MessageCircle, REMINDER: Bell, OTHER: Circle };
const TYPE_LABEL: Record<string, string> = { CALL: "Ligação", MEETING: "Reunião", EMAIL: "E-mail", WHATSAPP: "WhatsApp", REMINDER: "Lembrete", OTHER: "Outro" };

export function TasksView() {
  const qc = useQueryClient();
  const [view, setView] = useState<"list" | "month" | "week">("list");
  const [cursor, setCursor] = useState(new Date());
  const [newOpen, setNewOpen] = useState<Date | null>(null);
  const [onlyPending, setOnlyPending] = useState(true);

  const range = useMemo(() => {
    if (view === "month") return { from: startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 }), to: endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 }) };
    if (view === "week") return { from: startOfWeek(cursor), to: endOfWeek(cursor) };
    return { from: addDays(new Date(), -60), to: addDays(new Date(), 60) };
  }, [view, cursor]);

  const qs = new URLSearchParams({ from: range.from.toISOString(), to: range.to.toISOString(), ...(onlyPending && view === "list" && { status: "PENDING" }) });
  const { data: tasks = [] } = useQuery({ queryKey: ["tasks", qs.toString()], queryFn: () => api<Task[]>(`/api/tasks?${qs}`) });
  useSocketEvent("task:updated", useCallback(() => qc.invalidateQueries({ queryKey: ["tasks"] }), [qc]));

  const toggle = useMutation({
    mutationFn: (t: Task) => api(`/api/tasks/${t.id}`, { method: "PATCH", json: { status: t.status === "DONE" ? "PENDING" : "DONE" } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
  const create = useMutation({
    mutationFn: (b: unknown) => api("/api/tasks", { method: "POST", json: b }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); setNewOpen(null); },
  });

  const TaskRow = ({ t, compact }: { t: Task; compact?: boolean }) => {
    const Icon = ICON[t.type] ?? Circle;
    const overdue = t.status === "PENDING" && new Date(t.dueDate) < new Date();
    return (
      <div className={cn("flex items-center gap-2 rounded-md", compact ? "truncate px-1.5 py-0.5 text-[11px]" : "border bg-white p-3 text-sm", overdue ? "bg-red-50 text-red-700" : compact && "bg-secondary/10")}>
        <button onClick={() => toggle.mutate(t)} aria-label="Concluir">
          {t.status === "DONE" ? <CheckCircle2 size={compact ? 12 : 18} className="text-emerald-600" /> : <Icon size={compact ? 12 : 18} />}
        </button>
        <span className={cn("flex-1 truncate", t.status === "DONE" && "text-slate-400 line-through")}>
          {compact && `${format(new Date(t.dueDate), "HH:mm")} `}{t.title}
        </span>
        {!compact && (
          <>
            <span className="hidden text-xs text-slate-500 md:inline">{t.dealTitle ?? t.contactName}</span>
            <span className="text-xs text-slate-500">{t.userName}</span>
            <span className={cn("w-28 text-right text-xs", overdue ? "font-medium" : "text-slate-500")}>{format(new Date(t.dueDate), "dd/MM HH:mm")}</span>
          </>
        )}
      </div>
    );
  };

  const groups = useMemo(() => {
    const now = new Date();
    const g: Record<string, Task[]> = { Atrasadas: [], Hoje: [], Amanhã: [], "Próximos dias": [], Concluídas: [] };
    for (const t of tasks) {
      const d = new Date(t.dueDate);
      if (t.status === "DONE") g["Concluídas"].push(t);
      else if (d < now && !isToday(d)) g["Atrasadas"].push(t);
      else if (isToday(d)) g["Hoje"].push(t);
      else if (isSameDay(d, addDays(now, 1))) g["Amanhã"].push(t);
      else if (d > now) g["Próximos dias"].push(t);
    }
    return g;
  }, [tasks]);

  const days: Date[] = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) days.push(d);

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">Tarefas & Agenda</h1>
        <div className="flex rounded-lg border bg-white p-1 text-sm">
          <button onClick={() => setView("list")} className={cn("flex items-center gap-1 rounded-md px-3 py-1", view === "list" && "bg-primary text-primary-foreground")}><List size={14} /> Lista</button>
          <button onClick={() => setView("week")} className={cn("flex items-center gap-1 rounded-md px-3 py-1", view === "week" && "bg-primary text-primary-foreground")}><CalendarDays size={14} /> Semana</button>
          <button onClick={() => setView("month")} className={cn("flex items-center gap-1 rounded-md px-3 py-1", view === "month" && "bg-primary text-primary-foreground")}><CalendarDays size={14} /> Mês</button>
        </div>
        <Button onClick={() => setNewOpen(new Date())}><Plus size={16} /> Nova tarefa</Button>
      </div>

      {view === "list" ? (
        <div className="space-y-5">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} /> Somente pendentes</label>
          {Object.entries(groups).map(([name, list]) =>
            list.length ? (
              <section key={name}>
                <h2 className={cn("mb-2 text-sm font-semibold", name === "Atrasadas" && "text-red-600")}>{name} <span className="font-normal text-slate-400">({list.length})</span></h2>
                <div className="space-y-2">{list.map((t) => <TaskRow key={t.id} t={t} />)}</div>
              </section>
            ) : null,
          )}
        </div>
      ) : (
        <div className="rounded-xl border bg-white">
          <div className="flex items-center gap-2 border-b p-3">
            <Button size="icon" variant="ghost" onClick={() => setCursor(view === "month" ? subMonths(cursor, 1) : subWeeks(cursor, 1))}><ChevronLeft size={18} /></Button>
            <Button size="icon" variant="ghost" onClick={() => setCursor(view === "month" ? addMonths(cursor, 1) : addWeeks(cursor, 1))}><ChevronRight size={18} /></Button>
            <Button size="sm" variant="outline" onClick={() => setCursor(new Date())}>Hoje</Button>
            <p className="ml-2 font-medium capitalize">{format(cursor, view === "month" ? "MMMM yyyy" : "'Semana de' dd/MM", { locale: ptBR })}</p>
          </div>
          <div className="grid grid-cols-7 border-b text-center text-xs text-slate-500">
            {["dom", "seg", "ter", "qua", "qui", "sex", "sáb"].map((d) => <div key={d} className="py-2">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const list = tasks.filter((t) => isSameDay(new Date(t.dueDate), d));
              return (
                <div
                  key={d.toISOString()}
                  onDoubleClick={() => { const at = new Date(d); at.setHours(9, 0, 0, 0); setNewOpen(at); }}
                  className={cn("space-y-1 border-b border-r p-1.5", view === "month" ? "min-h-[110px]" : "min-h-[420px]", view === "month" && !isSameMonth(d, cursor) && "bg-slate-50 text-slate-400")}
                >
                  <p className={cn("text-right text-xs", isToday(d) && "font-bold text-primary")}>{format(d, "d")}</p>
                  {list.slice(0, view === "month" ? 4 : 30).map((t) => <TaskRow key={t.id} t={t} compact />)}
                  {view === "month" && list.length > 4 && <p className="text-[10px] text-slate-500">+{list.length - 4} mais</p>}
                </div>
              );
            })}
          </div>
          <p className="p-2 text-[11px] text-slate-400">Dica: dê duplo clique em um dia para criar uma tarefa.</p>
        </div>
      )}

      <Dialog open={!!newOpen} onOpenChange={(v) => !v && setNewOpen(null)} title="Nova tarefa">
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const v = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
            create.mutate({ title: v.title, type: v.type, description: v.description || null, dueDate: new Date(v.due).toISOString(), durationMin: v.duration ? Number(v.duration) : null });
          }}
        >
          <div><Label>Título *</Label><Input name="title" required /></div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Tipo</Label><Select name="type" className="w-full">{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
            <div className="col-span-2"><Label>Data e hora *</Label><Input name="due" type="datetime-local" required defaultValue={newOpen ? format(newOpen, "yyyy-MM-dd'T'HH:mm") : undefined} /></div>
          </div>
          <div><Label>Duração (min)</Label><Input name="duration" type="number" min="5" step="5" /></div>
          <div><Label>Descrição</Label><Textarea name="description" rows={3} /></div>
          <Button type="submit" disabled={create.isPending}>Criar</Button>
        </form>
      </Dialog>
    </div>
  );
}
