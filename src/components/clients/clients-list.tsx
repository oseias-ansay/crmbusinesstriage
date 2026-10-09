"use client";
/** Lista de clientes (quem contratou). Novos clientes entram sozinhos quando um negócio é ganho. */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertCircle, FileText, Plus, Search } from "lucide-react";
import { api } from "@/lib/fetcher";
import { brl } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { fmtDocument, STATUS } from "./status";

type Row = { id: string; razaoSocial: string; nomeFantasia: string | null; cnpj: string | null; status: string; valor: string; recorrente: boolean; inicioEm: string | null; responsavel: string | null; contratos: number; pendencias: number };

export function ClientsList() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);
  const { data = [], isLoading } = useQuery({
    queryKey: ["clients", q, status],
    queryFn: () => api<Row[]>(`/api/clients?${new URLSearchParams({ ...(q && { q }), ...(status && { status }) })}`),
  });
  const create = useMutation({
    mutationFn: (b: unknown) => api<{ id: string }>("/api/clients", { method: "POST", json: b }),
    onSuccess: (c) => router.push(`/clients/${c.id}`),
  });
  const mrr = data.filter((c) => c.status === "ACTIVE" && c.recorrente).reduce((s, c) => s + Number(c.valor), 0);

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">Clientes</h1>
        <span className="text-sm text-slate-500">{data.filter((c) => c.status === "ACTIVE").length} ativos · {brl(mrr)}/mês recorrente</span>
        <Button onClick={() => setOpen(true)}><Plus size={14} /> Novo cliente</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="relative"><Search size={14} className="absolute left-3 top-3 text-slate-400" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome ou CNPJ" className="w-72 pl-8" /></div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="p-3">Cliente</th><th className="p-3">CNPJ</th><th className="p-3">Situação</th><th className="p-3 text-right">Valor</th><th className="p-3">Início</th><th className="p-3">Responsável</th><th className="p-3">Contrato</th></tr>
          </thead>
          <tbody className="divide-y">
            {data.map((c) => (
              <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => router.push(`/clients/${c.id}`)}>
                <td className="p-3">
                  <Link href={`/clients/${c.id}`} className="font-medium hover:underline">{c.razaoSocial}</Link>
                  {c.nomeFantasia && <p className="text-xs text-slate-500">{c.nomeFantasia}</p>}
                </td>
                <td className="p-3 text-xs">{fmtDocument(c.cnpj) || "—"}</td>
                <td className="p-3"><Badge color={STATUS[c.status]?.color}>{STATUS[c.status]?.label ?? c.status}</Badge></td>
                <td className="p-3 text-right">{brl(Number(c.valor))}{c.recorrente && <span className="text-xs text-slate-400">/mês</span>}</td>
                <td className="p-3 text-xs">{c.inicioEm ? format(new Date(c.inicioEm), "dd/MM/yyyy") : "—"}</td>
                <td className="p-3 text-xs">{c.responsavel ?? "—"}</td>
                <td className="p-3 text-xs">
                  {c.pendencias > 0 ? (
                    <span className="flex items-center gap-1 text-amber-600"><AlertCircle size={13} /> faltam {c.pendencias} dado(s)</span>
                  ) : c.contratos > 0 ? (
                    <span className="flex items-center gap-1 text-emerald-700"><FileText size={13} /> {c.contratos} gerado(s)</span>
                  ) : (
                    <span className="text-slate-500">pronto para gerar</span>
                  )}
                </td>
              </tr>
            ))}
            {!isLoading && !data.length && (
              <tr><td colSpan={7} className="p-8 text-center text-slate-400">Nenhum cliente ainda. Quando um negócio for marcado como <b>Ganho</b>, a ficha aparece aqui automaticamente.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      <Dialog open={open} onOpenChange={setOpen} title="Novo cliente">
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); create.mutate(Object.fromEntries(new FormData(e.currentTarget))); }}>
          <div><Label>Razão social / nome</Label><Input name="razaoSocial" required /></div>
          <div><Label>CNPJ ou CPF</Label><Input name="cnpj" /></div>
          {create.error && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}
          <Button type="submit" disabled={create.isPending}>Criar e completar a ficha</Button>
        </form>
      </Dialog>
    </div>
  );
}
