"use client";
/** Base de contatos: busca, filtros avançados (tag, origem, campo personalizado), paginação e CSV. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Download, Plus, Search, Upload } from "lucide-react";
import { api } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";

type Row = {
  id: string; name: string; email: string | null; phone: string | null; source: string | null; createdAt: string;
  organization: string | null; owner: string | null; tags: { name: string; color: string }[]; customFields: Record<string, unknown>;
};

export function ContactsTable() {
  const qc = useQueryClient();
  const [f, setF] = useState({ q: "", tag: "", source: "", cfKey: "", cfValue: "" });
  const [page, setPage] = useState(1);
  const [newOpen, setNewOpen] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  const params = new URLSearchParams({ page: String(page), ...(f.q && { q: f.q }), ...(f.tag && { tag: f.tag }), ...(f.source && { source: f.source }), ...(f.cfKey && f.cfValue && { [`cf.${f.cfKey}`]: f.cfValue }) });
  const { data } = useQuery({ queryKey: ["contacts", params.toString()], queryFn: () => api<{ data: Row[]; total: number; pageSize: number }>(`/api/contacts?${params}`) });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const cfKeys = [...new Set((data?.data ?? []).flatMap((r) => Object.keys(r.customFields ?? {})))];

  const create = useMutation({
    mutationFn: (body: unknown) => api("/api/contacts", { method: "POST", json: body }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["contacts"] }); setNewOpen(false); },
  });

  async function importCsv(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const r = await api<{ created: number; updated: number; skipped: number }>("/api/contacts/import", { method: "POST", body: fd });
    setImportResult(`Importação concluída: ${r.created} criados, ${r.updated} atualizados, ${r.skipped} ignorados.`);
    qc.invalidateQueries({ queryKey: ["contacts"] });
  }

  const exportParams = new URLSearchParams(params);
  exportParams.delete("page");

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">Contatos <span className="text-sm font-normal text-slate-500">({data?.total ?? 0})</span></h1>
        <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50">
          <Upload size={16} /> Importar CSV
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
        </label>
        <Button variant="outline" asChild><a href={`/api/contacts/export?${exportParams}`}><Download size={16} /> Exportar</a></Button>
        <Button onClick={() => setNewOpen(true)}><Plus size={16} /> Novo contato</Button>
      </div>
      {importResult && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{importResult}</p>}

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <div className="relative min-w-[220px] flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" placeholder="Nome, e-mail ou telefone" value={f.q} onChange={(e) => { setF({ ...f, q: e.target.value }); setPage(1); }} />
        </div>
        <div><Label>Tag</Label><Input className="w-36" value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })} /></div>
        <div><Label>Origem</Label><Input className="w-36" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} /></div>
        <div><Label>Campo personalizado</Label>
          <div className="flex gap-1">
            <Select value={f.cfKey} onChange={(e) => setF({ ...f, cfKey: e.target.value })}><option value="">—</option>{cfKeys.map((k) => <option key={k}>{k}</option>)}</Select>
            <Input className="w-32" placeholder="valor" value={f.cfValue} onChange={(e) => setF({ ...f, cfValue: e.target.value })} />
          </div>
        </div>
      </Card>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-4 py-2">Nome</th><th className="px-4 py-2">Contato</th><th className="px-4 py-2">Empresa</th><th className="px-4 py-2">Tags</th><th className="px-4 py-2">Origem</th><th className="px-4 py-2">Responsável</th><th className="px-4 py-2">Criado</th></tr>
          </thead>
          <tbody>
            {data?.data.map((r) => (
              <tr key={r.id} className="border-t hover:bg-slate-50">
                <td className="px-4 py-2 font-medium"><Link href={`/contacts/${r.id}`} className="hover:underline">{r.name}</Link></td>
                <td className="px-4 py-2 text-slate-600"><div>{r.phone}</div><div className="text-xs">{r.email}</div></td>
                <td className="px-4 py-2">{r.organization ?? "—"}</td>
                <td className="px-4 py-2"><div className="flex flex-wrap gap-1">{r.tags.map((t) => <Badge key={t.name} color={t.color}>{t.name}</Badge>)}</div></td>
                <td className="px-4 py-2">{r.source ?? "—"}</td>
                <td className="px-4 py-2">{r.owner ?? "—"}</td>
                <td className="px-4 py-2 text-slate-500">{format(new Date(r.createdAt), "dd/MM/yyyy")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-end gap-2 border-t p-3 text-sm">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button>
          <span>Página {page} de {pages}</span>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Próxima</Button>
        </div>
      </Card>

      <Dialog open={newOpen} onOpenChange={setNewOpen} title="Novo contato">
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const v = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
            create.mutate({ name: v.name, email: v.email || null, phone: v.phone || null, source: v.source || null, tags: v.tags ? v.tags.split(",").map((s) => s.trim()) : [] });
          }}
        >
          <div><Label>Nome *</Label><Input name="name" required /></div>
          <div className="grid grid-cols-2 gap-3"><div><Label>Telefone</Label><Input name="phone" /></div><div><Label>E-mail</Label><Input name="email" type="email" /></div></div>
          <div className="grid grid-cols-2 gap-3"><div><Label>Origem</Label><Input name="source" /></div><div><Label>Tags</Label><Input name="tags" placeholder="separadas por vírgula" /></div></div>
          {create.error && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}
          <Button type="submit" disabled={create.isPending}>Salvar</Button>
        </form>
      </Dialog>
    </div>
  );
}
