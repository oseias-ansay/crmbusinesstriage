"use client";
/**
 * Renderiza a resposta da IA com uma formatação simples e segura (sem HTML):
 * títulos (#), listas (- / 1.), **negrito**, citações [n] e blocos ```whatsapp```
 * (mostrados como cartão com ações).
 */
import { Fragment, type ReactNode } from "react";

export type Part = { kind: "text"; text: string } | { kind: "whatsapp"; text: string };

/** Separa o texto em trechos normais e mensagens sugeridas (```whatsapp ... ```). */
export function splitParts(src: string): Part[] {
  const parts: Part[] = [];
  const re = /```(?:whatsapp|mensagem)?\s*\n([\s\S]*?)```/gi;
  let last = 0;
  for (const m of src.matchAll(re)) {
    if (m.index! > last) parts.push({ kind: "text", text: src.slice(last, m.index) });
    parts.push({ kind: "whatsapp", text: m[1].trim() });
    last = m.index! + m[0].length;
  }
  if (last < src.length) parts.push({ kind: "text", text: src.slice(last) });
  return parts.filter((p) => p.text.trim());
}

function inline(s: string, cite?: (n: number) => string | undefined): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|\[\d{1,3}\])/g).map((t, i) => {
    if (/^\*\*[^*]+\*\*$/.test(t)) return <strong key={i}>{t.slice(2, -2)}</strong>;
    const c = t.match(/^\[(\d{1,3})\]$/);
    if (c) {
      const title = cite?.(Number(c[1]));
      return (
        <sup key={i} title={title} className="mx-0.5 cursor-help rounded bg-secondary/15 px-1 text-[10px] font-semibold text-secondary">
          {c[1]}
        </sup>
      );
    }
    return <Fragment key={i}>{t}</Fragment>;
  });
}

export function RichText({ text, cite }: { text: string; cite?: (n: number) => string | undefined }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const L = list.ordered ? "ol" : "ul";
    blocks.push(
      <L key={blocks.length} className={list.ordered ? "ml-5 list-decimal space-y-0.5" : "ml-5 list-disc space-y-0.5"}>
        {list.items.map((it, i) => <li key={i}>{inline(it, cite)}</li>)}
      </L>,
    );
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const b = line.match(/^\s*[-*•]\s+(.*)/);
    const o = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (b || o) {
      const ordered = !!o;
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
      list.items.push((b ?? o)![1]);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const h = line.match(/^#{1,4}\s+(.*)/);
    blocks.push(h ? <p key={blocks.length} className="font-semibold">{inline(h[1], cite)}</p> : <p key={blocks.length}>{inline(line, cite)}</p>);
  }
  flush();
  return <div className="space-y-1.5">{blocks}</div>;
}
