"use client";
/**
 * Base de conhecimento do Copiloto de vendas: documentos de texto
 * (digitados, colados ou importados de PDF/Word), por categoria.
 * Só documentos ATIVOS entram nas respostas.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, FileUp, Plus, Trash2, Wand2 } from "lucide-react";
import { api } from "@/lib/fetcher";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Doc = { id: string; title: string; category: string; content: string; sourceFile: string | null; isActive: boolean; updatedAt: string };
type Data = { docs: Doc[]; categories: Record<string, string>; fullLimit: number };

export function KnowledgePanel() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["knowledge"], queryFn: () => api<Data>("/api/knowledge") });
  const [sel, setSel] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", category: "geral", content: "", isActive: true });
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const cur = data?.docs.find((d) => d.id === sel) ?? null;

  useEffect(() => { if (!sel && data?.docs[0]) setSel(data.docs[0].id); }, [data, sel]);
  useEffect(() => { if (cur) setForm({ title: cur.title, category: cur.category, content: cur.content, isActive: cur.isActive }); }, [cur?.id, cur?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = () => { setErr(null); qc.invalidateQueries({ queryKey: ["knowledge"] }); };
  const onError = (e: Error) => setErr(e.message);
  const save = useMutation({ mutationFn: () => api(`/api/knowledge/${sel}`, { method: "PATCH", json: form }), onSuccess: done, onError });
  const create = useMutation({
    mutationFn: () => api<Doc>("/api/knowledge", { method: "POST", json: { title: "Novo documento", category: "geral", content: "Escreva ou cole aqui o conteúdo." } }),
    onSuccess: (d) => { done(); setSel(d.id); },
    onError,
  });
  const del = useMutation({ mutationFn: () => api(`/api/knowledge/${sel}`, { method: "DELETE" }), onSuccess: () => { setSel(null); done(); }, onError });
  const starter = useMutation({ mutationFn: () => api<Doc[]>("/api/knowledge/starter", { method: "POST" }), onSuccess: (d) => { done(); setSel(d[0]?.id ?? null); }, onError });

  async function importFile(file: File) {
    setUploading(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("category", cur?.category ?? "geral");
      const d = await api<Doc>("/api/knowledge/import", { method: "POST", body: fd });
      done();
      setSel(d.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  const stats = useMemo(() => {
    const active = data?.docs.filter((d) => d.isActive) ?? [];
    const chars = active.reduce((s, d) => s + d.content.length, 0);
    return { active: active.length, chars, pages: Math.max(1, Math.round(chars / 2500)) };
  }, [data]);

  if (!data) return <p className="text-sm text-slate-500">Carregando…</p>;
  const dirty = cur && (form.title !== cur.title || form.category !== cur.category || form.content !== cur.content || form.isActive !== cur.isActive);

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-3 p-4 text-sm">
        <BookOpen size={18} className="text-secondary" />
        <div className="mr-auto">
          <p className="font-medium">Base de conhecimento do Copiloto de vendas</p>
          <p className="text-xs text-slate-500">
            O Copiloto (aba no card do negócio) responde ao vendedor usando só estes documentos. {stats.active} ativo(s) · cerca de {stats.pages} página(s)
            {stats.chars > data.fullLimit && " · base grande: o Copiloto usa os trechos mais relacionados a cada pergunta"}.
          </p>
        </div>
        <label className={`inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border px-3 text-sm hover:bg-slate-50 ${uploading ? "pointer-events-none opacity-50" : ""}`}>
          <FileUp size={14} /> {uploading ? "Lendo arquivo…" : "Importar PDF / Word"}
          <input type="file" accept=".pdf,.docx,.txt,.md,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) importFile(f); }} />
        </label>
        <Button size="sm" variant="outline" onClick={() => create.mutate()}><Plus size={14} /> Novo documento</Button>
      </Card>

      {err && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{err}</p>}

      {!data.docs.length ? (
        <Card className="space-y-3 p-6 text-center text-sm text-slate-600">
          <p>A base ainda está vazia. Comece pelos 4 documentos essenciais: <b>processo de vendas, quebra de objeções, tabela de preços e perguntas frequentes</b>.</p>
          <Button onClick={() => starter.mutate()} disabled={starter.isPending}><Wand2 size={14} /> Criar roteiros para preencher</Button>
          <p className="text-xs text-slate-400">Os roteiros entram desativados: preencha cada um e marque "Ativo" para o Copiloto passar a usar.</p>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <Card className="divide-y self-start">
            {data.docs.map((d) => (
              <button key={d.id} onClick={() => setSel(d.id)} className={`block w-full p-3 text-left text-sm hover:bg-slate-50 ${d.id === sel ? "bg-secondary/10" : ""}`}>
                <p className="flex items-center gap-1 font-medium">{d.title}{!d.isActive && <Badge color="#94A3B8">inativo</Badge>}</p>
                <p className="text-xs text-slate-500">{data.categories[d.category] ?? d.category} · {(d.content.length / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil caracteres</p>
              </button>
            ))}
          </Card>

          {cur && (
            <Card className="space-y-3 p-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
                <div><Label>Título</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
                <div>
                  <Label>Categoria</Label>
                  <Select className="w-full" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                    {Object.entries(data.categories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </div>
              </div>
              <div>
                <Label>Conteúdo</Label>
                <Textarea rows={20} className="font-mono text-xs" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
                {cur.sourceFile && <p className="mt-1 text-xs text-slate-400">Importado de {cur.sourceFile}. Confira se o texto saiu completo (tabelas de PDF às vezes precisam de ajuste).</p>}
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Ativo (o Copiloto usa este documento)</label>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending || !form.title.trim() || !form.content.trim()}>Salvar</Button>
                <Button variant="ghost" className="ml-auto text-red-600" onClick={() => confirm(`Excluir "${cur.title}"?`) && del.mutate()}><Trash2 size={14} /> Excluir</Button>
              </div>
              <details className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                <summary className="cursor-pointer font-medium">Dicas para respostas melhores</summary>
                <ul className="mt-2 list-disc space-y-1 pl-4">
                  <li>Escreva preços e condições de forma explícita (valor, o que inclui, parcelamento, desconto máximo). O Copiloto nunca informa o que não estiver aqui.</li>
                  <li>Nas objeções, use o formato "Objeção → significado → resposta → prova".</li>
                  <li>Um assunto por documento facilita as citações [n] nas respostas.</li>
                  <li>Mantenha atualizado: ao mudar a tabela de preços, edite aqui no mesmo dia.</li>
                </ul>
              </details>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
