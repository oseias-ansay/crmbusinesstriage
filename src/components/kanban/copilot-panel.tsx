"use client";
/**
 * Copiloto de vendas (aba do card): o vendedor pergunta e a IA responde com
 * base na base de conhecimento da empresa + contexto do lead. Mensagens
 * sugeridas aparecem como cartão com "Copiar" e "Enviar no WhatsApp".
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { BookOpen, Check, Copy, Eraser, Send, Sparkles } from "lucide-react";
import { api } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { RichText, splitParts } from "@/components/ui/rich-text";

type Msg = { id: string; role: "user" | "assistant"; content: string; createdAt: string; userName: string | null; meta: { fontes?: number[]; action?: string } | null };
type Data = { messages: Msg[]; base: { docs: number; chars: number; refs: { n: number; id: string; title: string }[] }; actions: { key: string; label: string }[] };

export function CopilotPanel({ dealId, hasWhatsapp }: { dealId: string; hasWhatsapp: boolean }) {
  const qc = useQueryClient();
  const key = ["copilot", dealId];
  const { data } = useQuery({ queryKey: key, queryFn: () => api<Data>(`/api/deals/${dealId}/copilot`) });
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  const ask = useMutation({
    mutationFn: (b: { question?: string; action?: string; label: string }) => api(`/api/deals/${dealId}/copilot`, { method: "POST", json: { question: b.question, action: b.action } }),
    onMutate: (b) => { setErr(null); setPending(b.label); setQ(""); },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: Error, b) => { setErr(e.message); if (b.question) setQ(b.question); },
    onSettled: () => setPending(null),
  });
  const clear = useMutation({ mutationFn: () => api(`/api/deals/${dealId}/copilot`, { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: key }) });

  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [data?.messages.length, pending]);

  if (!data) return <p className="pt-4 text-sm text-slate-500">Carregando…</p>;
  const cite = (n: number) => data.base.refs.find((r) => r.n === n)?.title;
  const busy = ask.isPending;

  return (
    <div className="space-y-3 pt-4">
      {data.base.docs === 0 && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
          <BookOpen size={14} className="mt-0.5 shrink-0" />
          <span>A base de conhecimento está vazia: o Copiloto só consegue dar orientações gerais. Cadastre o processo de vendas, as objeções e os preços em <Link href="/settings?tab=knowledge" className="underline">Configurações → Base de conhecimento</Link>.</span>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {data.actions.map((a) => (
          <button key={a.key} disabled={busy} onClick={() => ask.mutate({ action: a.key, label: a.label })} className="rounded-full border px-3 py-1 text-xs hover:border-secondary hover:bg-secondary/5 disabled:opacity-50">
            {a.label}
          </button>
        ))}
      </div>

      <div className="max-h-[48vh] space-y-3 overflow-y-auto pr-1">
        {!data.messages.length && !pending && (
          <p className="rounded-lg bg-slate-50 p-4 text-center text-sm text-slate-500">
            <Sparkles size={16} className="mx-auto mb-1 text-secondary" />
            Pergunte qualquer coisa sobre este atendimento: como responder uma objeção, qual plano indicar, o que dizer agora…
          </p>
        )}
        {data.messages.map((m) => (m.role === "user" ? (
          <div key={m.id} className="ml-10 rounded-xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
            {m.content}
            {m.userName && <p className="mt-0.5 text-[10px] text-primary-foreground/60">{m.userName}</p>}
          </div>
        ) : (
          <Answer key={m.id} m={m} cite={cite} dealId={dealId} hasWhatsapp={hasWhatsapp} />
        )))}
        {pending && (
          <>
            <div className="ml-10 rounded-xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">{pending}</div>
            <div className="mr-10 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-500"><Sparkles size={14} className="animate-pulse text-secondary" /> Consultando a base e a conversa…</div>
          </>
        )}
        <div ref={end} />
      </div>

      {err && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{err}</p>}

      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (q.trim()) ask.mutate({ question: q.trim(), label: q.trim() }); }}>
        <Textarea
          rows={2}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (q.trim() && !busy) ask.mutate({ question: q.trim(), label: q.trim() }); } }}
          placeholder="Ex.: o cliente disse que está caro, como respondo?"
          className="flex-1"
        />
        <Button type="submit" size="icon" disabled={busy || !q.trim()} title="Perguntar (Enter)"><Send size={16} /></Button>
      </form>
      <div className="flex items-center justify-between text-[11px] text-slate-400">
        <span>{data.base.docs} documento(s) na base · as respostas podem errar: confira antes de enviar.</span>
        {!!data.messages.length && <button className="flex items-center gap-1 hover:text-slate-600" onClick={() => confirm("Apagar o histórico do Copiloto neste card?") && clear.mutate()}><Eraser size={12} /> Limpar</button>}
      </div>
    </div>
  );
}

function Answer({ m, cite, dealId, hasWhatsapp }: { m: Msg; cite: (n: number) => string | undefined; dealId: string; hasWhatsapp: boolean }) {
  const parts = splitParts(m.content);
  const fontes = (m.meta?.fontes ?? []).map((n) => ({ n, t: cite(n) })).filter((f) => f.t);
  return (
    <div className="mr-6 space-y-2 rounded-xl rounded-bl-sm border bg-white px-3 py-2 text-sm">
      {parts.map((p, i) => (p.kind === "text" ? <RichText key={i} text={p.text} cite={cite} /> : <Suggestion key={i} text={p.text} dealId={dealId} hasWhatsapp={hasWhatsapp} />))}
      {!!fontes.length && (
        <p className="border-t pt-1.5 text-[11px] text-slate-500">
          Fontes: {fontes.map((f) => <span key={f.n} className="mr-2"><sup className="font-semibold text-secondary">{f.n}</sup> {f.t}</span>)}
        </p>
      )}
    </div>
  );
}

function Suggestion({ text, dealId, hasWhatsapp }: { text: string; dealId: string; hasWhatsapp: boolean }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(text);
  const [copied, setCopied] = useState(false);
  const send = useMutation({
    mutationFn: () => api(`/api/deals/${dealId}/copilot/send`, { method: "POST", json: { text: value } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["deal", dealId] }); qc.invalidateQueries({ queryKey: ["copilot", dealId] }); },
  });
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-2">
      <p className="mb-1 text-[11px] font-medium text-emerald-800">Mensagem sugerida (pode editar antes de enviar)</p>
      <Textarea rows={Math.min(8, Math.max(3, value.split("\n").length + 1))} value={value} onChange={(e) => setValue(e.target.value)} className="bg-white text-sm" />
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copiado" : "Copiar"}
        </Button>
        {hasWhatsapp && (
          <Button size="sm" disabled={send.isPending || send.isSuccess || !value.trim()} onClick={() => confirm("Enviar esta mensagem ao cliente pelo WhatsApp?") && send.mutate()}>
            <Send size={13} /> {send.isSuccess ? "Enviada" : "Enviar no WhatsApp"}
          </Button>
        )}
        {send.error && <span className="text-xs text-red-600">{(send.error as Error).message}</span>}
      </div>
    </div>
  );
}
