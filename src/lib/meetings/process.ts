/**
 * ════════════════════════════════════════════════════════════════════
 *  Reuniões gravadas → transcrição → resumo e avaliação da IA
 * ════════════════════════════════════════════════════════════════════
 *  1. O vendedor envia a gravação (áudio/vídeo do Meet, Zoom, celular) ou a
 *     transcrição pronta (.txt/.vtt/.srt/.docx/.pdf) pelo card.
 *  2. Áudio/vídeo: ffmpeg extrai o áudio em MP3 mono leve; acima de ~24 MB é
 *     dividido em partes de 20 min; cada parte vai para a API de transcrição
 *     da OpenAI (a IA do CRM, Claude, não transcreve áudio).
 *  3. Claude lê a transcrição + o contexto do negócio e devolve: resumo, dores,
 *     objeções (e se foram tratadas), o que foi combinado, próximo passo,
 *     tarefas e a avaliação do vendedor pelos 7 passos da venda consultiva.
 *  4. Tarefas sugeridas viram tarefas do responsável; tudo fica no card.
 *  Retenção: o arquivo de áudio/vídeo é apagado após N dias (padrão 90);
 *  a transcrição e o resumo continuam.
 */
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { and, desc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { withAdmin, withTenant } from "@/db";
import { contacts, deals, meetingRecords, pipelines, stages, tasks, tenants, type MeetingSummary } from "@/db/schema";
import { aiConfig, callMessages, consumeQuota } from "@/lib/ai/anthropic";
import { extractText } from "@/lib/copilot/knowledge";
import { logActivity, notify } from "@/lib/activity";
import { emitToTenant } from "@/lib/realtime";

const run = promisify(execFile);
export const UPLOAD_BASE = () => path.resolve(process.env.UPLOAD_DIR ?? "./data/uploads");
const CHUNK_LIMIT = 24 * 1024 * 1024; // limite da API de transcrição é 25 MB
const MAX_TRANSCRIPT = 150_000; // caracteres enviados à IA (~2 h de conversa)

export const TEXT_EXT = /\.(txt|vtt|srt|md|docx|pdf)$/i;
export const MEDIA_EXT = /\.(mp3|m4a|mp4|wav|webm|ogg|oga|opus|mkv|mov|aac|flac|mpeg|mpga)$/i;

type Status = "PENDING" | "TRANSCRIBING" | "ANALYZING" | "DONE" | "FAILED";
async function setStatus(tenantId: string, id: string, status: Status, extra: Partial<typeof meetingRecords.$inferInsert> = {}) {
  await withTenant(tenantId, (tx) => tx.update(meetingRecords).set({ status, updatedAt: new Date(), ...extra }).where(eq(meetingRecords.id, id)));
  emitToTenant(tenantId, "meeting:updated", { id, status });
}

/** Limpa legendas .vtt/.srt (tempos e numeração) e devolve só as falas. */
export function cleanCaptions(t: string) {
  return t
    .replace(/^WEBVTT.*$/m, "")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !/^\d+$/.test(l.trim()) && !/-->/.test(l) && !/^(NOTE|STYLE)\b/.test(l))
    .join("\n")
    .replace(/<[^>]+>/g, "")
    .trim();
}

// ───────────────────────── transcrição ─────────────────────────

async function transcribeAudio(file: string, workDir: string, apiKey: string, model: string): Promise<{ text: string; durationSec?: number }> {
  await mkdir(workDir, { recursive: true });
  let durationSec: number | undefined;
  try {
    const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { timeout: 60_000 });
    durationSec = Math.round(Number(stdout.trim())) || undefined;
  } catch {}
  // MP3 mono 16 kHz 32 kbps ≈ 14 MB/hora: leve e suficiente para voz
  const mp3 = path.join(workDir, "audio.mp3");
  await run("ffmpeg", ["-y", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", mp3], { timeout: 15 * 60_000, maxBuffer: 10 * 1024 * 1024 });
  let parts = [mp3];
  if ((await stat(mp3)).size > CHUNK_LIMIT) {
    await run("ffmpeg", ["-y", "-i", mp3, "-f", "segment", "-segment_time", "1200", "-c", "copy", path.join(workDir, "part%03d.mp3")], { timeout: 10 * 60_000 });
    parts = (await readdir(workDir)).filter((f) => /^part\d+\.mp3$/.test(f)).sort().map((f) => path.join(workDir, f));
  }
  const base = process.env.OPENAI_BASE_URL ?? "https://api.openai.com";
  const out: string[] = [];
  for (const p of parts) {
    const fd = new FormData();
    fd.append("file", new Blob([await readFile(p)], { type: "audio/mpeg" }), path.basename(p));
    fd.append("model", model);
    fd.append("language", "pt");
    fd.append("response_format", "text");
    const res = await fetch(`${base}/v1/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: fd, signal: AbortSignal.timeout(10 * 60_000) });
    const body = await res.text();
    if (!res.ok) {
      if (res.status === 401) throw new Error("Chave da OpenAI inválida (Integrações → IA → Transcrição).");
      if (res.status === 429) throw new Error("Limite ou saldo da OpenAI esgotado. Confira o painel da OpenAI.");
      throw new Error(`Transcrição falhou (${res.status}): ${body.slice(0, 200)}`);
    }
    out.push(body.trim().startsWith("{") ? (JSON.parse(body).text ?? "") : body.trim());
  }
  return { text: out.join("\n\n").trim(), durationSec };
}

// ───────────────────────── análise ─────────────────────────

const SYSTEM = `Você é um analista comercial sênior. Recebe a transcrição de um atendimento de vendas online (reunião entre o vendedor da empresa e um cliente) e o contexto do negócio no CRM.
A transcrição pode não indicar quem fala: deduza pelo contexto quem é o vendedor e quem é o cliente.
Responda APENAS com um JSON válido, sem texto antes ou depois, neste formato:
{
 "resumo": "3 a 5 frases sobre o atendimento",
 "perfil": "quem é o cliente e a empresa dele, em 1 ou 2 frases",
 "dores": ["necessidades e problemas que o cliente relatou"],
 "objecoes": [{"objecao": "o que o cliente disse", "resposta": "como o vendedor respondeu", "tratada": true}],
 "combinado": ["o que ficou acordado entre as partes"],
 "proximoPasso": "próximo passo concreto, com data se foi citada",
 "tarefas": [{"titulo": "ação para o vendedor (verbo no infinitivo)", "prazoDias": 2}],
 "avaliacao": {"nota": 0-10, "pontosFortes": ["..."], "melhorar": ["conselho prático"], "etapas": {"abordagem": 0-10, "diagnostico": 0-10, "construcaoValor": 0-10, "objecoes": 0-10, "fechamento": 0-10}},
 "temperatura": "quente" | "morno" | "frio"
}
Critérios da avaliação (venda consultiva): o vendedor compreendeu antes de oferecer; fez perguntas de situação, problema, implicação e necessidade; resumiu o que entendeu antes de apresentar a solução; ligou a solução às dores do cliente com provas; tratou objeções acolhendo, explorando e respondendo sem dar desconto de imediato; terminou com próximo passo claro (o quê, quem, quando).
Use só o que está na transcrição: não invente nomes, valores, datas nem acordos. Listas vazias quando não houver. No máximo 5 tarefas. Português do Brasil.`;

export function parseSummary(raw: string): MeetingSummary | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as MeetingSummary;
    const arr = <T,>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
    return {
      resumo: String(j.resumo ?? ""),
      perfil: j.perfil ? String(j.perfil) : undefined,
      dores: arr<string>(j.dores).map(String).slice(0, 10),
      objecoes: arr<{ objecao: string; resposta?: string; tratada?: boolean }>(j.objecoes).slice(0, 10),
      combinado: arr<string>(j.combinado).map(String).slice(0, 10),
      proximoPasso: j.proximoPasso ? String(j.proximoPasso) : undefined,
      tarefas: arr<{ titulo: string; prazoDias?: number }>(j.tarefas).filter((t) => t?.titulo).slice(0, 5),
      avaliacao: j.avaliacao,
      temperatura: ["quente", "morno", "frio"].includes(String(j.temperatura)) ? j.temperatura : undefined,
    };
  } catch {
    return null;
  }
}

function clip(t: string) {
  if (t.length <= MAX_TRANSCRIPT) return t;
  const half = MAX_TRANSCRIPT / 2;
  return `${t.slice(0, half)}\n\n[… trecho do meio omitido por tamanho …]\n\n${t.slice(-half)}`;
}

// ───────────────────────── orquestração ─────────────────────────

export async function processMeeting(tenantId: string, id: string) {
  const [m] = await withTenant(tenantId, (tx) => tx.select().from(meetingRecords).where(eq(meetingRecords.id, id)).limit(1));
  if (!m || m.status === "DONE") return;
  const [t] = await withAdmin((tx) => tx.select({ name: tenants.name, settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1));
  const ai = t.settings.ai ?? {};
  const workDir = path.join(UPLOAD_BASE(), ".tmp", id);
  try {
    let transcript = m.transcript ?? "";
    if (!transcript) {
      if (!m.filePath) throw new Error("Arquivo da gravação não encontrado.");
      const abs = path.join(UPLOAD_BASE(), m.filePath);
      if (TEXT_EXT.test(m.fileName)) {
        const buf = await readFile(abs);
        const txt = await extractText(new File([buf], m.fileName, { type: m.mimeType ?? "" }));
        transcript = /\.(vtt|srt)$/i.test(m.fileName) ? cleanCaptions(txt) : txt;
      } else {
        const key = ai.transcribeKey || process.env.OPENAI_API_KEY;
        if (!key) throw new Error("Configure a chave de transcrição (OpenAI) em Configurações → Integrações → IA, ou envie a transcrição em texto (.txt, .vtt, .docx).");
        await setStatus(tenantId, id, "TRANSCRIBING");
        const r = await transcribeAudio(abs, workDir, key, ai.transcribeModel || "whisper-1");
        transcript = r.text;
        if (r.durationSec) await setStatus(tenantId, id, "TRANSCRIBING", { durationSec: r.durationSec });
      }
      if (transcript.length < 30) throw new Error("A transcrição saiu vazia. Confira se o arquivo tem áudio com fala.");
      await setStatus(tenantId, id, "ANALYZING", { transcript });
    } else {
      await setStatus(tenantId, id, "ANALYZING");
    }

    const cfg = aiConfig(t.settings);
    if (!cfg.apiKey) throw new Error("Configure a chave da Anthropic em Integrações → IA para gerar o resumo. A transcrição já está salva.");
    if (!(await consumeQuota(tenantId, cfg.dailyLimit))) throw new Error(`Limite diário de ${cfg.dailyLimit} chamadas de IA atingido. Tente amanhã ou aumente o limite.`);

    const ctx = await withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .select({ title: deals.title, userId: deals.userId, stage: stages.name, pipeline: pipelines.name, contact: contacts.name, cf: contacts.customFields })
        .from(deals)
        .innerJoin(stages, eq(stages.id, deals.stageId))
        .innerJoin(pipelines, eq(pipelines.id, deals.pipelineId))
        .leftJoin(contacts, eq(contacts.id, deals.contactId))
        .where(eq(deals.id, m.dealId))
        .limit(1);
      return row;
    });
    const campos = Object.entries((ctx?.cf ?? {}) as Record<string, unknown>)
      .filter(([k, v]) => !k.startsWith("_") && v != null && v !== "")
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${String(v)}`)
      .join("; ");
    const user = `Empresa do vendedor: ${t.name}\nNegócio: ${ctx?.title} (funil ${ctx?.pipeline}, etapa "${ctx?.stage}")\nCliente: ${ctx?.contact ?? "—"}${campos ? `\nDados do cliente no CRM: ${campos}` : ""}\n\nTRANSCRIÇÃO DO ATENDIMENTO:\n${clip(transcript)}`;
    const { text } = await callMessages({ apiKey: cfg.apiKey, model: cfg.model, system: [{ type: "text", text: SYSTEM }], messages: [{ role: "user", content: user }], maxTokens: 2500, timeoutMs: 120_000 });
    const summary = parseSummary(text);
    if (!summary) throw new Error("A IA não devolveu o resumo no formato esperado. Tente reprocessar.");

    // Tarefas sugeridas → tarefas do responsável do negócio (ou de quem enviou)
    const owner = ctx?.userId ?? m.userId;
    let created = 0;
    await withTenant(tenantId, async (tx) => {
      if (owner && !m.tasksCreated) {
        for (const tk of summary.tarefas ?? []) {
          const days = Math.min(30, Math.max(0, Number(tk.prazoDias ?? 2) || 2));
          await tx.insert(tasks).values({ tenantId, userId: owner, dealId: m.dealId, contactId: m.contactId, title: tk.titulo.slice(0, 200), type: "OTHER", dueDate: new Date(Date.now() + days * 86_400_000) });
          created++;
        }
        if (created) await notify(tx, { tenantId, userId: owner, title: "Reunião analisada", body: `${m.title}: ${created} tarefa(s) criada(s)`, link: "/tasks" });
      }
      await tx.update(meetingRecords).set({ status: "DONE", summary, error: null, tasksCreated: m.tasksCreated || created, updatedAt: new Date() }).where(eq(meetingRecords.id, id));
      await logActivity(tx, { tenantId, type: "NOTE", summary: `Reunião analisada: ${m.title}${summary.proximoPasso ? ` — próximo passo: ${summary.proximoPasso}` : ""}`.slice(0, 500), dealId: m.dealId, contactId: m.contactId, userId: m.userId, meta: { meetingId: id } });
    });
    emitToTenant(tenantId, "meeting:updated", { id, status: "DONE" });
  } catch (e) {
    await setStatus(tenantId, id, "FAILED", { error: (e instanceof Error ? e.message : String(e)).slice(0, 500) });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Dispara o processamento sem bloquear a requisição. */
export function processMeetingInBackground(tenantId: string, id: string) {
  setImmediate(() => processMeeting(tenantId, id).catch((e) => console.error("[meeting]", e)));
}

/** Chamado pelo worker: retoma reuniões paradas (ex.: servidor reiniciou) e aplica a retenção. */
export async function meetingHousekeeping() {
  const stale = await withAdmin((tx) =>
    tx
      .select({ id: meetingRecords.id, tenantId: meetingRecords.tenantId })
      .from(meetingRecords)
      .where(and(inArray(meetingRecords.status, ["PENDING", "TRANSCRIBING", "ANALYZING"]), lt(meetingRecords.updatedAt, new Date(Date.now() - 20 * 60_000))))
      .orderBy(desc(meetingRecords.updatedAt))
      .limit(3),
  );
  for (const s of stale) {
    await withAdmin((tx) => tx.update(meetingRecords).set({ updatedAt: new Date() }).where(eq(meetingRecords.id, s.id)));
    processMeetingInBackground(s.tenantId, s.id);
  }
  const expired = await withAdmin((tx) =>
    tx.select({ id: meetingRecords.id, filePath: meetingRecords.filePath }).from(meetingRecords).where(and(isNotNull(meetingRecords.filePath), lt(meetingRecords.retainUntil, new Date()), sql`${meetingRecords.status} in ('DONE','FAILED')`)).limit(20),
  );
  for (const x of expired) {
    await rm(path.join(UPLOAD_BASE(), x.filePath!), { force: true }).catch(() => {});
    await withAdmin((tx) => tx.update(meetingRecords).set({ filePath: null }).where(eq(meetingRecords.id, x.id)));
  }
}
