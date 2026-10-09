"use client";
/** Painel Admin Global: provisionar clientes white-label, planos, limites, módulos e status. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus } from "lucide-react";
import { api } from "@/lib/fetcher";
import { MODULES, PLAN_PRESETS } from "@/lib/plans";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";

type T = {
  tenant: { id: string; name: string; slug: string; domain: string | null; status: string; plan: keyof typeof PLAN_PRESETS; maxUsers: number; maxContacts: number; enabledModules: string[]; primaryColor: string; secondaryColor: string; createdAt: string };
  usersCount: number; contactsCount: number; dealsCount: number;
};
const STATUS_COLOR: Record<string, string> = { ACTIVE: "#10B981", TRIAL: "#3B82F6", SUSPENDED: "#F59E0B", CANCELED: "#EF4444" };

export function AdminTenants() {
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["admin-tenants"], queryFn: () => api<T[]>("/api/admin/tenants") });
  const [edit, setEdit] = useState<Partial<T["tenant"]> & { owner?: { name: string; email: string; password: string } } | null>(null);
  const save = useMutation({
    mutationFn: (b: typeof edit) => (b!.id ? api(`/api/admin/tenants/${b!.id}`, { method: "PATCH", json: b }) : api("/api/admin/tenants", { method: "POST", json: b })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-tenants"] }); setEdit(null); },
  });
  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "crm.businesstriage.com.br";

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center">
        <h1 className="mr-auto text-xl font-semibold">Admin Global — Clientes (Tenants)</h1>
        <Button onClick={() => setEdit({ plan: "STARTER", status: "TRIAL", primaryColor: "#0F2A44", secondaryColor: "#14B8A6", enabledModules: [...PLAN_PRESETS.STARTER.modules], maxUsers: 3, maxContacts: 2000, owner: { name: "", email: "", password: "" } })}>
          <Plus size={16} /> Novo cliente
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.map(({ tenant: t, usersCount, contactsCount, dealsCount }) => (
          <Card key={t.id} className="cursor-pointer p-4 hover:shadow-md" onClick={() => setEdit(t)}>
            <div className="flex items-center gap-3">
              <span className="rounded-lg p-2 text-white" style={{ background: t.primaryColor }}><Building2 size={18} /></span>
              <div className="min-w-0 flex-1"><p className="truncate font-semibold">{t.name}</p><p className="truncate text-xs text-slate-500">{t.domain ?? `${t.slug}.${root}`}</p></div>
              <Badge color={STATUS_COLOR[t.status]}>{t.status}</Badge>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded bg-slate-50 p-2"><p className="text-base font-semibold">{usersCount}/{t.maxUsers}</p>usuários</div>
              <div className="rounded bg-slate-50 p-2"><p className="text-base font-semibold">{contactsCount}</p>contatos</div>
              <div className="rounded bg-slate-50 p-2"><p className="text-base font-semibold">{dealsCount}</p>negócios</div>
            </div>
            <p className="mt-2 text-xs text-slate-500">Plano {t.plan} · {t.enabledModules.length} módulos</p>
          </Card>
        ))}
      </div>

      {edit && (
        <Dialog open onOpenChange={(v) => !v && setEdit(null)} title={edit.id ? `Editar ${edit.name}` : "Provisionar novo cliente"}>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Nome</Label><Input value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value, ...(!edit.id && { slug: e.target.value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") }) })} /></div>
              <div><Label>Slug (subdomínio)</Label><Input value={edit.slug ?? ""} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, slug: e.target.value })} /></div>
            </div>
            <div><Label>Domínio próprio (opcional)</Label><Input value={edit.domain ?? ""} onChange={(e) => setEdit({ ...edit, domain: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Plano</Label>
                <Select className="w-full" value={edit.plan} onChange={(e) => { const p = e.target.value as keyof typeof PLAN_PRESETS; setEdit({ ...edit, plan: p, maxUsers: PLAN_PRESETS[p].maxUsers, maxContacts: PLAN_PRESETS[p].maxContacts, enabledModules: [...PLAN_PRESETS[p].modules] }); }}>
                  {Object.keys(PLAN_PRESETS).map((p) => <option key={p}>{p}</option>)}
                </Select>
              </div>
              <div><Label>Status</Label><Select className="w-full" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>{Object.keys(STATUS_COLOR).map((s) => <option key={s}>{s}</option>)}</Select></div>
              <div><Label>Máx. usuários</Label><Input type="number" value={edit.maxUsers} onChange={(e) => setEdit({ ...edit, maxUsers: Number(e.target.value) })} /></div>
              <div><Label>Máx. contatos</Label><Input type="number" value={edit.maxContacts} onChange={(e) => setEdit({ ...edit, maxContacts: Number(e.target.value) })} /></div>
              <div><Label>Cor primária</Label><Input type="color" className="p-1" value={edit.primaryColor} onChange={(e) => setEdit({ ...edit, primaryColor: e.target.value.toUpperCase() })} /></div>
              <div><Label>Cor secundária</Label><Input type="color" className="p-1" value={edit.secondaryColor} onChange={(e) => setEdit({ ...edit, secondaryColor: e.target.value.toUpperCase() })} /></div>
            </div>
            <div>
              <Label>Módulos ativos</Label>
              <div className="grid grid-cols-2 gap-1">
                {MODULES.map((m) => (
                  <label key={m.key} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={edit.enabledModules?.includes(m.key)} onChange={(e) => setEdit({ ...edit, enabledModules: e.target.checked ? [...(edit.enabledModules ?? []), m.key] : edit.enabledModules!.filter((x) => x !== m.key) })} />
                    {m.label}
                  </label>
                ))}
              </div>
            </div>
            {!edit.id && edit.owner && (
              <fieldset className="grid gap-2 rounded-lg border p-3">
                <legend className="px-1 text-xs text-slate-500">Usuário dono (OWNER)</legend>
                <Input placeholder="Nome" value={edit.owner.name} onChange={(e) => setEdit({ ...edit, owner: { ...edit.owner!, name: e.target.value } })} />
                <Input placeholder="E-mail" type="email" value={edit.owner.email} onChange={(e) => setEdit({ ...edit, owner: { ...edit.owner!, email: e.target.value } })} />
                <Input placeholder="Senha inicial (8+)" type="password" value={edit.owner.password} onChange={(e) => setEdit({ ...edit, owner: { ...edit.owner!, password: e.target.value } })} />
              </fieldset>
            )}
            {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
            <Button onClick={() => save.mutate({ ...edit, domain: edit.domain || null, ...(edit.id && { owner: undefined }) })} disabled={save.isPending}>{edit.id ? "Salvar" : "Criar cliente"}</Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
