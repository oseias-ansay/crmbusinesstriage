"use client";
/** Edição dos dados do negócio dentro do painel 360°. */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { api } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { CustomFieldsInputs, useFieldDefs } from "@/components/forms/custom-fields";

export type EditableDeal = {
  id: string; title: string; value: string; recurring: boolean; userId: string | null; expectedCloseAt: string | null;
  source: string | null; customFields: Record<string, unknown>; tags: { tag: { name: string } }[];
};

export function EditDealForm({ deal, onDone }: { deal: EditableDeal; onDone: () => void }) {
  const { data: team = [] } = useQuery({ queryKey: ["users"], queryFn: () => api<{ id: string; name: string; isActive: boolean }[]>("/api/users") });
  const { data: defs = [] } = useFieldDefs("DEAL");
  const [cf, setCf] = useState<Record<string, unknown>>(deal.customFields ?? {});
  const save = useMutation({ mutationFn: (b: unknown) => api(`/api/deals/${deal.id}`, { method: "PATCH", json: b }), onSuccess: onDone });

  return (
    <form
      className="grid gap-3 rounded-xl border bg-slate-50 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
        save.mutate({
          title: f.title,
          value: Number(f.value || 0),
          recurring: f.recurring === "on",
          userId: f.userId || null,
          expectedCloseAt: f.expectedCloseAt ? new Date(`${f.expectedCloseAt}T12:00:00`).toISOString() : null,
          source: f.source || null,
          tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
          customFields: cf,
        });
      }}
    >
      <div><Label>Título</Label><Input name="title" defaultValue={deal.title} required /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Valor (R$)</Label><Input name="value" type="number" step="0.01" min="0" defaultValue={Number(deal.value)} /></div>
        <div><Label>Previsão de fechamento</Label><Input name="expectedCloseAt" type="date" defaultValue={deal.expectedCloseAt ? format(new Date(deal.expectedCloseAt), "yyyy-MM-dd") : ""} /></div>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="recurring" defaultChecked={deal.recurring} /> Valor recorrente mensal (MRR)</label>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Responsável</Label>
          <Select name="userId" className="w-full" defaultValue={deal.userId ?? ""}>
            <option value="">— sem responsável —</option>
            {team.filter((u) => u.isActive || u.id === deal.userId).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </div>
        <div><Label>Origem</Label><Input name="source" defaultValue={deal.source ?? ""} /></div>
      </div>
      <div><Label>Tags (separadas por vírgula)</Label><Input name="tags" defaultValue={deal.tags.map((t) => t.tag.name).join(", ")} /></div>
      <CustomFieldsInputs defs={defs} values={cf} onChange={setCf} />
      {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending}>{save.isPending ? "Salvando…" : "Salvar"}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>
      </div>
    </form>
  );
}
