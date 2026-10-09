"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { api } from "@/lib/fetcher";
import type { PipelineDef, TeamUser } from "./types";

export function NewDealDialog({ open, onOpenChange, pipeline, team }: { open: boolean; onOpenChange: (v: boolean) => void; pipeline: PipelineDef; team: TeamUser[] }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: (body: unknown) => api("/api/deals", { method: "POST", json: body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deals"] });
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    create.mutate({
      title: f.title,
      pipelineId: pipeline.id,
      stageId: f.stageId,
      value: Number(f.value || 0),
      recurring: f.recurring === "on",
      userId: f.userId || null,
      source: f.source || null,
      tags: f.tags ? f.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
      contact: { name: f.contactName, email: f.email || null, phone: f.phone || null },
    });
  }

  const openStages = pipeline.stages.filter((s) => !s.isWon && !s.isLost);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Novo negócio · ${pipeline.name}`}>
      <form onSubmit={submit} className="grid gap-3">
        <div><Label>Título *</Label><Input name="title" required placeholder="Diagnóstico financeiro — Empresa X" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Valor (R$)</Label><Input name="value" type="number" step="0.01" min="0" /></div>
          <div><Label>Etapa</Label>
            <Select name="stageId" className="w-full">{openStages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="recurring" /> Valor recorrente mensal (MRR)</label>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Responsável</Label>
            <Select name="userId" className="w-full"><option value="">Eu mesmo</option>{team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
          </div>
          <div><Label>Origem</Label><Input name="source" placeholder="meta_ads, indicação…" /></div>
        </div>
        <fieldset className="grid gap-3 rounded-lg border p-3">
          <legend className="px-1 text-xs font-medium text-slate-500">Contato</legend>
          <div><Label>Nome *</Label><Input name="contactName" required /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>WhatsApp</Label><Input name="phone" placeholder="(41) 99999-9999" /></div>
            <div><Label>E-mail</Label><Input name="email" type="email" /></div>
          </div>
        </fieldset>
        <div><Label>Tags (separadas por vírgula)</Label><Input name="tags" placeholder="Quente, Meta Ads" /></div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" disabled={create.isPending}>{create.isPending ? "Salvando…" : "Criar negócio"}</Button>
      </form>
    </Dialog>
  );
}
