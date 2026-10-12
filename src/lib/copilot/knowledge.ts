/**
 * Base de conhecimento do Copiloto.
 *  - Base pequena (até ~120 mil caracteres, umas 50 páginas): vai INTEIRA para a
 *    IA, em cache na Anthropic → mais preciso e barato que busca por trechos.
 *  - Base grande: quebra em trechos e manda só os mais relacionados à pergunta
 *    (pontuação por palavras em comum, sem acento, ignorando palavras comuns).
 *  - Extração de texto de PDF (unpdf) e Word (mammoth) na importação.
 */
import { z } from "zod";

export const CATEGORIES: Record<string, string> = {
  processo: "Processo de vendas",
  objecoes: "Quebra de objeções",
  precos: "Preços e condições",
  produtos: "Produtos e serviços",
  politicas: "Políticas (desconto, prazo, garantia)",
  faq: "Perguntas frequentes",
  geral: "Geral",
};

export const docSchema = z.object({
  title: z.string().trim().min(2).max(160),
  category: z.enum(Object.keys(CATEGORIES) as [string, ...string[]]).default("geral"),
  content: z.string().trim().min(1).max(300_000),
  isActive: z.boolean().optional(),
});

export const FULL_LIMIT = 120_000; // caracteres enviados por inteiro
const CHUNK = 1_500;
const BUDGET = 60_000; // caracteres no modo de trechos

type Doc = { id: string; title: string; category: string; content: string };
export type KbRef = { n: number; id: string; title: string };

const STOP = new Set(
  "a o as os um uma de da do das dos e em no na nos nas para por com sem que se como mais menos muito pouco ja nao sim eu voce ele ela nos eles elas meu minha seu sua isso esse essa este esta ao aos ou mas qual quais quando onde porque pra pro tem ter ser foi sao esta estou cliente".split(" "),
);
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const terms = (s: string) => norm(s).match(/[a-z0-9]{3,}/g)?.filter((w) => !STOP.has(w)) ?? [];

function chunks(text: string) {
  const out: string[] = [];
  let cur = "";
  for (const p of text.split(/\n{2,}/)) {
    if (cur && cur.length + p.length > CHUNK) { out.push(cur); cur = ""; }
    cur += (cur ? "\n\n" : "") + p;
    while (cur.length > CHUNK * 2) { out.push(cur.slice(0, CHUNK)); cur = cur.slice(CHUNK); }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Monta o texto da base para a IA. `query` só é usada quando a base é grande. */
export function buildKnowledge(docs: Doc[], query: string): { text: string; refs: KbRef[]; mode: "vazia" | "completa" | "trechos"; chars: number } {
  const refs = docs.map((d, i) => ({ n: i + 1, id: d.id, title: d.title }));
  const total = docs.reduce((s, d) => s + d.content.length, 0);
  if (!docs.length) return { text: "", refs, mode: "vazia", chars: 0 };
  const head = (d: Doc, i: number) => `### [${i + 1}] ${d.title} — ${CATEGORIES[d.category] ?? d.category}`;

  if (total <= FULL_LIMIT) {
    return { text: docs.map((d, i) => `${head(d, i)}\n${d.content.trim()}`).join("\n\n"), refs, mode: "completa", chars: total };
  }

  // Modo trechos: pontua cada trecho pelas palavras da pergunta (título conta em dobro)
  const q = new Set(terms(query));
  const scored = docs.flatMap((d, i) =>
    chunks(d.content).map((c, j) => {
      const words = terms(c);
      const tw = new Set(terms(d.title));
      let score = 0;
      for (const w of words) if (q.has(w)) score += 1;
      for (const w of tw) if (q.has(w)) score += 3;
      // preços e objeções costumam ser consultados: leve preferência quando a pergunta fala disso
      if (d.category === "precos" && /preco|valor|custa|plano|desconto/.test(norm(query))) score += 2;
      if (d.category === "objecoes" && /caro|objec|pensar|depois|concorr/.test(norm(query))) score += 2;
      return { i, j, c, score: score / Math.sqrt(words.length + 10) };
    }),
  );
  scored.sort((a, b) => b.score - a.score || a.i - b.i || a.j - b.j);
  let used = 0;
  const picked = scored.filter((s) => (used += s.c.length) <= BUDGET);
  picked.sort((a, b) => a.i - b.i || a.j - b.j);
  const byDoc = new Map<number, string[]>();
  for (const p of picked) byDoc.set(p.i, [...(byDoc.get(p.i) ?? []), p.c]);
  const text = [...byDoc.entries()].map(([i, cs]) => `${head(docs[i], i)} (trechos)\n${cs.join("\n[…]\n")}`).join("\n\n");
  return { text, refs, mode: "trechos", chars: total };
}

/** Extrai texto de um arquivo enviado (PDF, Word .docx, .txt, .md, .csv). */
export async function extractText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await pdfText(pdf, { mergePages: false });
    return (Array.isArray(text) ? text.join("\n\n") : text).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const r = await mammoth.extractRawText({ buffer: buf });
    return r.value.replace(/\n{3,}/g, "\n\n").trim();
  }
  if (/\.(txt|md|csv)$/.test(name) || file.type.startsWith("text/")) return buf.toString("utf8").trim();
  throw new Error("Formato não suportado. Envie PDF, Word (.docx), TXT, MD ou CSV.");
}
