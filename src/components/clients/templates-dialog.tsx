"use client";
/** Editor dos modelos de contrato (texto com {{variáveis}}). */
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Star, Trash2 } from "lucide-react";
import { api } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";

type Tpl = { id: string; name: string; body: string; isDefault: boolean };

export function TemplatesDialog({ open, onOpenChange, templates, variaveis }: { open: boolean; onOpenChange: (v: boolean) => void; templates: Tpl[]; variaveis: string[] }) {
  const qc = useQueryClient();
  const [sel, setSel] = useState<string | null>(templates[0]?.id ?? null);
  const cur = templates.find((t) => t.id === sel) ?? null;
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setName(cur?.name ?? ""); setBody(cur?.body ?? ""); }, [cur?.id, cur?.name, cur?.body]);

  const done = () => { setErr(null); qc.invalidateQueries({ queryKey: ["contract-templates"] }); };
  const onError = (e: Error) => setErr(e.message);
  const save = useMutation({ mutationFn: () => api(`/api/contract-templates/${sel}`, { method: "PATCH", json: { name, body } }), onSuccess: done, onError });
  const create = useMutation({
    mutationFn: () => api<Tpl>("/api/contract-templates", { method: "POST", json: { name: "Novo modelo", body: cur?.body ?? "# CONTRATO\n\nTexto do contrato com {{cliente.razaoSocial}}…\n\n[[assinaturas]]" } }),
    onSuccess: (t) => { done(); setSel(t.id); },
    onError,
  });
  const del = useMutation({ mutationFn: () => api(`/api/contract-templates/${sel}`, { method: "DELETE" }), onSuccess: () => { done(); setSel(templates.find((t) => t.id !== sel)?.id ?? null); }, onError });
  const fav = useMutation({ mutationFn: () => api(`/api/contract-templates/${sel}`, { method: "PATCH", json: { isDefault: true } }), onSuccess: done, onError });

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Modelos de contrato" side="right" className="max-w-4xl">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1">
          {templates.map((t) => (
            <button key={t.id} onClick={() => setSel(t.id)} className={`flex items-center gap-1 rounded-lg border px-3 py-1 text-sm ${t.id === sel ? "border-secondary bg-secondary/10" : ""}`}>
              {t.isDefault && <Star size={11} className="fill-amber-400 text-amber-400" />}{t.name}
            </button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => create.mutate()}><Plus size={14} /> Novo (cópia)</Button>
        </div>
        {err && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{err}</p>}
        {cur && (
          <>
            <div><Label>Nome</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div>
              <Label>Texto</Label>
              <Textarea rows={22} className="font-mono text-xs" value={body} onChange={(e) => setBody(e.target.value)} />
            </div>
            <details className="rounded-lg bg-slate-50 p-3 text-xs">
              <summary className="cursor-pointer font-medium">Como escrever o modelo e variáveis disponíveis</summary>
              <p className="mt-2"><code># Título</code> · <code>## Cláusula</code> · <code>- item de lista</code> · <code>**negrito**</code> · linha em branco separa parágrafos · <code>[[assinaturas]]</code> · <code>[[quebra]]</code> (nova página)</p>
              <p className="mt-2 flex flex-wrap gap-1">{variaveis.map((v) => <code key={v} className="rounded bg-white px-1">{`{{${v}}}`}</code>)}</p>
            </details>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => save.mutate()} disabled={save.isPending || (name === cur.name && body === cur.body)}>Salvar modelo</Button>
              {!cur.isDefault && <Button variant="outline" onClick={() => fav.mutate()}><Star size={14} /> Tornar padrão</Button>}
              <Button variant="ghost" className="ml-auto text-red-600" onClick={() => confirm(`Excluir o modelo "${cur.name}"? Contratos já gerados não mudam.`) && del.mutate()}><Trash2 size={14} /> Excluir</Button>
            </div>
            <p className="text-xs text-amber-700">O modelo inicial é genérico. Revise as cláusulas com seu advogado antes de usar com clientes.</p>
          </>
        )}
      </div>
    </Dialog>
  );
}
