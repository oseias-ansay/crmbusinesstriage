"use client";
/** Cartão do Kanban com indicadores: valor, tempo na etapa, tarefas em atraso, responsável e tags. */
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlarmClock, CalendarClock, Repeat } from "lucide-react";
import { differenceInDays } from "date-fns";
import { Avatar } from "@/components/ui/avatar";
import { brl, cn } from "@/lib/utils";
import type { KanbanDeal } from "./types";

export function DealCardView({ deal, rottingDays, dragging, onOpen }: { deal: KanbanDeal; rottingDays?: number | null; dragging?: boolean; onOpen?: () => void }) {
  const daysInStage = differenceInDays(new Date(), new Date(deal.stageEnteredAt));
  const rotting = rottingDays != null && daysInStage >= rottingDays && deal.status === "OPEN";

  return (
    <div
      onClick={onOpen}
      className={cn(
        "group cursor-grab rounded-lg border bg-white p-3 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing",
        dragging && "rotate-2 shadow-xl ring-2 ring-secondary",
        rotting && "border-l-4 border-l-amber-400",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-sm font-medium leading-snug">{deal.title}</p>
        <Avatar name={deal.userName} src={deal.userAvatar} size={24} />
      </div>
      {deal.contactName && <p className="mt-0.5 truncate text-xs text-slate-500">{deal.contactName}</p>}

      <div className="mt-2 flex items-center gap-1 text-sm font-semibold tabular-nums text-slate-800">
        {brl(deal.value)}
        {deal.recurring && <Repeat size={12} className="text-secondary" aria-label="Recorrente (MRR)" />}
      </div>

      {deal.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {deal.tags.slice(0, 3).map((t) => (
            <span key={t.name} className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: `${t.color}1F`, color: t.color }}>
              {t.name}
            </span>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center gap-3 border-t pt-2 text-[11px] text-slate-500">
        <span className={cn("flex items-center gap-1", rotting && "font-medium text-amber-600")} title="Tempo na etapa">
          <CalendarClock size={12} /> {daysInStage === 0 ? "hoje" : `${daysInStage}d`}
        </span>
        {deal.overdueTasks > 0 ? (
          <span className="flex items-center gap-1 font-medium text-red-600" title="Tarefas em atraso">
            <AlarmClock size={12} /> {deal.overdueTasks} atrasada{deal.overdueTasks > 1 && "s"}
          </span>
        ) : deal.openTasks > 0 ? (
          <span className="flex items-center gap-1" title="Tarefas abertas">
            <AlarmClock size={12} /> {deal.openTasks}
          </span>
        ) : (
          <span className="text-amber-600" title="Sem próxima tarefa">sem tarefa</span>
        )}
      </div>
    </div>
  );
}

export function SortableDealCard({ deal, rottingDays, onOpen }: { deal: KanbanDeal; rottingDays?: number | null; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: deal.id, data: { type: "deal", stageId: deal.stageId } });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }} {...attributes} {...listeners}>
      <DealCardView deal={deal} rottingDays={rottingDays} onOpen={onOpen} />
    </div>
  );
}
