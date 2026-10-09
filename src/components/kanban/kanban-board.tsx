"use client";
/**
 * ════════════════════════════════════════════════════════════════════
 *  Kanban interativo (estilo Kommo/Pipedrive)
 * ════════════════════════════════════════════════════════════════════
 *  - Drag & drop entre colunas e dentro da coluna (dnd-kit)
 *  - Atualização otimista + POST /api/deals/:id/move
 *  - Sincronização em tempo real via Socket.io (outros usuários veem o card andar)
 *  - Filtros: responsável, período, valor, tag e busca
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Filter, Plus, Search } from "lucide-react";
import { api } from "@/lib/fetcher";
import { brl, cn } from "@/lib/utils";
import { useSocketEvent } from "@/hooks/useSocket";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { DealCardView, SortableDealCard } from "./deal-card";
import { DealDrawer } from "./deal-drawer";
import { NewDealDialog } from "./new-deal-dialog";
import type { KanbanDeal, PipelineDef, StageDef, TeamUser } from "./types";

type Columns = Record<string, KanbanDeal[]>;

function Column({ stage, deals, onOpen }: { stage: StageDef; deals: KanbanDeal[]; onOpen: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id, data: { type: "column" } });
  const total = deals.reduce((s, d) => s + Number(d.value), 0);
  return (
    <div className="flex w-72 shrink-0 flex-col rounded-xl bg-slate-100/80">
      <div className="px-3 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: stage.color }} />
          <h3 className="truncate text-sm font-semibold">{stage.name}</h3>
          <span className="ml-auto rounded-full bg-white px-2 text-xs text-slate-500">{deals.length}</span>
        </div>
        <p className="mt-1 text-xs tabular-nums text-slate-500">
          {brl(total)} <span className="text-slate-400">· {stage.probability}%</span>
        </p>
        <div className="mt-2 h-1 rounded-full" style={{ background: stage.color }} />
      </div>
      <div ref={setNodeRef} className={cn("scroll-thin flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-3", isOver && "bg-secondary/5")}>
        <SortableContext items={deals.map((d) => d.id)} strategy={verticalListSortingStrategy}>
          {deals.map((d) => (
            <SortableDealCard key={d.id} deal={d} rottingDays={stage.rottingDays} onOpen={() => onOpen(d.id)} />
          ))}
        </SortableContext>
        {deals.length === 0 && <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-400">Arraste negócios para cá</p>}
      </div>
    </div>
  );
}

export function KanbanBoard() {
  const qc = useQueryClient();
  const { data: pipelines = [] } = useQuery({ queryKey: ["pipelines"], queryFn: () => api<PipelineDef[]>("/api/pipelines") });
  const { data: team = [] } = useQuery({ queryKey: ["users"], queryFn: () => api<TeamUser[]>("/api/users") });

  const [pipelineId, setPipelineId] = useState<string>("");
  const [filters, setFilters] = useState({ q: "", userId: "", tag: "", minValue: "", from: "" });
  const [showFilters, setShowFilters] = useState(false);
  const [openDealId, setOpenDealId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  useEffect(() => {
    if (!pipelineId && pipelines.length) setPipelineId((pipelines.find((p) => p.isDefault) ?? pipelines[0]).id);
  }, [pipelines, pipelineId]);

  // Abre card via ?deal=<id> (links de notificação)
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("deal");
    if (id) setOpenDealId(id);
  }, []);

  const pipeline = pipelines.find((p) => p.id === pipelineId);
  const qs = new URLSearchParams({ pipelineId, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) }).toString();
  const queryKey = ["deals", qs];
  const { data: deals = [], isLoading } = useQuery({ queryKey, queryFn: () => api<KanbanDeal[]>(`/api/deals?${qs}`), enabled: !!pipelineId });

  // Estado local das colunas (permite feedback instantâneo durante o arraste)
  const [columns, setColumns] = useState<Columns>({});
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (activeId || !pipeline) return;
    const cols: Columns = Object.fromEntries(pipeline.stages.map((s) => [s.id, [] as KanbanDeal[]]));
    for (const d of [...deals].sort((a, b) => a.position - b.position)) cols[d.stageId]?.push(d);
    setColumns(cols);
  }, [deals, pipeline, activeId]);

  // Tempo real: qualquer alteração de negócio por outro usuário recarrega a coluna
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ["deals"] }), [qc]);
  useSocketEvent("deal:moved", refresh);
  useSocketEvent("deal:created", refresh);
  useSocketEvent("deal:updated", refresh);
  useSocketEvent("deal:deleted", refresh);

  const move = useMutation({
    mutationFn: (v: { id: string; stageId: string; beforeId?: string; afterId?: string }) =>
      api(`/api/deals/${v.id}/move`, { method: "POST", json: { stageId: v.stageId, beforeId: v.beforeId ?? null, afterId: v.afterId ?? null } }),
    onError: () => refresh(), // desfaz o otimista recarregando do servidor
    onSettled: () => qc.invalidateQueries({ queryKey: ["deals"] }),
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), // permite clique para abrir
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findColumn = (id: string) => (id in columns ? id : Object.keys(columns).find((k) => columns[k].some((d) => d.id === id)));

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  // Move o card entre colunas enquanto arrasta (preview)
  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const from = findColumn(String(active.id));
    const to = findColumn(String(over.id));
    if (!from || !to || from === to) return;
    setColumns((prev) => {
      const card = prev[from].find((d) => d.id === active.id)!;
      const overIndex = prev[to].findIndex((d) => d.id === over.id);
      const index = overIndex >= 0 ? overIndex : prev[to].length;
      const toList = [...prev[to]];
      toList.splice(index, 0, { ...card, stageId: to });
      return { ...prev, [from]: prev[from].filter((d) => d.id !== active.id), [to]: toList };
    });
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    setActiveId(null);
    if (!over) return refresh();
    const col = findColumn(String(active.id));
    const overCol = findColumn(String(over.id));
    if (!col || !overCol) return;

    let list = columns[col];
    if (col === overCol) {
      const oldIndex = list.findIndex((d) => d.id === active.id);
      const newIndex = list.findIndex((d) => d.id === over.id);
      if (newIndex >= 0 && oldIndex !== newIndex) list = arrayMove(list, oldIndex, newIndex);
      setColumns((prev) => ({ ...prev, [col]: list }));
    }
    const idx = list.findIndex((d) => d.id === active.id);
    const original = deals.find((d) => d.id === active.id);
    // Soltou no mesmo lugar? Não chama a API
    const originalOrder = deals.filter((d) => d.stageId === col).sort((a, b) => a.position - b.position).map((d) => d.id);
    if (original?.stageId === col && originalOrder.indexOf(String(active.id)) === idx) return;
    move.mutate({ id: String(active.id), stageId: col, beforeId: list[idx - 1]?.id, afterId: list[idx + 1]?.id });
  }

  const activeDeal = activeId ? Object.values(columns).flat().find((d) => d.id === activeId) : null;
  const allTags = useMemo(() => [...new Set(deals.flatMap((d) => d.tags.map((t) => t.name)))], [deals]);
  const totalOpen = deals.filter((d) => d.status === "OPEN").reduce((s, d) => s + Number(d.value), 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b bg-white px-6 py-3">
        <Select value={pipelineId} onChange={(e) => setPipelineId(e.target.value)} className="font-medium">
          {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <span className="text-sm text-slate-500">
          {deals.length} negócios · <b className="tabular-nums text-slate-700">{brl(totalOpen)}</b> em aberto
        </span>
        <div className="relative ml-auto">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input placeholder="Buscar negócio…" className="w-56 pl-9" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        </div>
        <Button variant="outline" onClick={() => setShowFilters((v) => !v)}><Filter size={16} /> Filtros</Button>
        <Button onClick={() => setNewOpen(true)}><Plus size={16} /> Novo negócio</Button>
      </div>

      {showFilters && (
        <div className="flex flex-wrap items-end gap-3 border-b bg-slate-50 px-6 py-3 text-sm">
          <label>Responsável<br />
            <Select value={filters.userId} onChange={(e) => setFilters({ ...filters, userId: e.target.value })}>
              <option value="">Todos</option>
              {team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </label>
          <label>Tag<br />
            <Select value={filters.tag} onChange={(e) => setFilters({ ...filters, tag: e.target.value })}>
              <option value="">Todas</option>
              {allTags.map((t) => <option key={t}>{t}</option>)}
            </Select>
          </label>
          <label>Valor mínimo<br /><Input type="number" className="w-32" value={filters.minValue} onChange={(e) => setFilters({ ...filters, minValue: e.target.value })} /></label>
          <label>Criados desde<br /><Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></label>
          <Button variant="ghost" onClick={() => setFilters({ q: "", userId: "", tag: "", minValue: "", from: "" })}>Limpar</Button>
        </div>
      )}

      <div className="scroll-thin flex flex-1 gap-3 overflow-x-auto p-4">
        {isLoading && <p className="text-sm text-slate-500">Carregando funil…</p>}
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => { setActiveId(null); refresh(); }}>
          {pipeline?.stages.map((s) => <Column key={s.id} stage={s} deals={columns[s.id] ?? []} onOpen={setOpenDealId} />)}
          <DragOverlay>{activeDeal ? <DealCardView deal={activeDeal} dragging /> : null}</DragOverlay>
        </DndContext>
      </div>

      {pipeline && <NewDealDialog open={newOpen} onOpenChange={setNewOpen} pipeline={pipeline} team={team} />}
      <DealDrawer dealId={openDealId} onClose={() => setOpenDealId(null)} />
    </div>
  );
}
