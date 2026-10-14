"use client";
/**
 * Aba "Reuniões" do card: envia a gravação (ou a transcrição) do atendimento
 * online e mostra o resumo, objeções, combinados, tarefas e a avaliação da IA.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CheckCircle2, Download, FileAudio, Loader2, RotateCcw, Trash2, Upload, XCircle } from "lucide-react";
import { api } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { MeetingSummary } from "@/db/schema";

type Row = {
  id: string; title: string; fileName: string; status: string; error: string | null; summary: MeetingSummary | null; durationSec: number | null;
  sizeBytes: number; tasksCreated: number; hasFile: boolean; hasTranscript: boolean; createdAt: string; userName: string | null;
};

const STATUS: Record<string, { label: string; color: string }> = {
  PENDING: { label: "Na fila", color: "#94A3B8" },
  TRANSCRIBING: { label: "Transcrevendo…", color: "#38BDF8" },
  ANALYZING: { label: "Analisando…", color: "#818CF8" },
  DONE: { label: "Pronto", color: "#10B981" },
  FAILED: { label: "Falhou", color: "#EF4444" },
};
const ETAPA: Record<string, string> = { abordagem: "Abordagem", diagnostico: "Diagnóstico", construcaoValor: "Construção de valor", objecoes: "Objeções", fechamento: "Fechamento" };
const TEMP: Record<string, string> = { quente: "#EF4444", morno: "#F59E0B", frio: "#38BDF8" };

export function MeetingsPanel({ dealId }: { dealId: string }) {
  const qc = useQueryClient();
  const key = ["meetings", dealId];
  const { data = [] } = useQuery({
    queryKey: key,
    queryFn: () => api<Row[]>(`/api/deals/${dealId}/meetings`),
    refetchInterval: (q) => ((q.state.data as Row[] | undefined)?.some((r) => !["DONE", "FAILED"].includes(r.status)) ? 4000 : false),
  });
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [consent, setConsent] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function upload() {
    if (!file) return;
    setErr(null);
    setProgress(0);
    const xhr = new XMLHttpRequest();
    const q = new URLSearchParams({ name: file.name, consent: "1", ...(title.trim() && { title: title.trim() }) });
    xhr.open("POST", `/api/deals/${dealId}/meetings?${q}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      setProgress(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        setFile(null); setTitle(""); setConsent(false);
        qc.invalidateQueries({ queryKey: key });
      } else {
        try { setErr(JSON.parse(xhr.responseText).error ?? "Falha no envio"); } catch { setErr("Falha no envio"); }
      }
    };
    xhr.onerror = () => { setProgress(null); setErr("Falha de conexão no envio."); };
    xhr.send(file);
  }

  return (
    <div className="space-y-4 pt-4">
      <div className="space-y-2 rounded-xl border border-dashed p-3">
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600 hover:bg-slate-100">
          <Upload size={16} /> {file ? `${file.name} (${(file.size / 1048576).toFixed(1)} MB)` : "Escolher gravação (áudio/vídeo) ou transcrição (.txt, .vtt, .docx, .pdf)"}
          <input type="file" className="hidden" accept="audio/*,video/*,.txt,.vtt,.srt,.docx,.pdf,.md" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        {file && (
          <>
            <Input placeholder="Título (opcional), ex.: Diagnóstico inicial" value={title} onChange={(e) => setTitle(e.target.value)} />
            <label className="flex items-start gap-2 text-xs text-slate-600">
              <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              O cliente foi informado no início da reunião de que ela seria gravada e analisada, e concordou (LGPD).
            </label>
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={!consent || progress !== null} onClick={upload}>
                {progress !== null ? <><Loader2 size={13} className="animate-spin" /> Enviando {progress}%</> : <><FileAudio size={13} /> Enviar e resumir</>}
              </Button>
              <span className="text-[11px] text-slate-400">Até 500 MB. Vídeos: o CRM extrai só o áudio.</span>
            </div>
          </>
        )}
        {err && <p className="rounded bg-red-50 p-2 text-xs text-red-700">{err}</p>}
      </div>

      {!data.length && <p className="text-center text-sm text-slate-400">Nenhuma reunião enviada ainda.</p>}
      {data.map((m) => <MeetingCard key={m.id} m={m} dealId={dealId} />)}
    </div>
  );
}

function List({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-slate-500">{title}</p>
      <ul className="ml-4 list-disc space-y-0.5 text-sm">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}

function MeetingCard({ m, dealId }: { m: Row; dealId: string }) {
  const qc = useQueryClient();
  const [showT, setShowT] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["meetings", dealId] }); qc.invalidateQueries({ queryKey: ["deal", dealId] }); };
  const retry = useMutation({ mutationFn: () => api(`/api/meetings/${m.id}/retry`, { method: "POST" }), onSuccess: refresh });
  const del = useMutation({ mutationFn: () => api(`/api/meetings/${m.id}`, { method: "DELETE" }), onSuccess: refresh });
  const full = useQuery({ queryKey: ["meeting", m.id], queryFn: () => api<{ transcript: string | null }>(`/api/meetings/${m.id}`), enabled: showT });
  const st = STATUS[m.status] ?? STATUS.PENDING;
  const s = m.summary;
  const busy = !["DONE", "FAILED"].includes(m.status);

  return (
    <div className="space-y-3 rounded-xl border bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{m.title}</p>
        <Badge color={st.color}>{busy && <Loader2 size={10} className="mr-1 inline animate-spin" />}{st.label}</Badge>
        {s?.temperatura && <Badge color={TEMP[s.temperatura]}>Lead {s.temperatura}</Badge>}
        <span className="ml-auto text-[11px] text-slate-400">
          {format(new Date(m.createdAt), "dd/MM/yy HH:mm")}{m.userName && ` · ${m.userName}`}{m.durationSec && ` · ${Math.round(m.durationSec / 60)} min`}
        </span>
      </div>

      {m.status === "FAILED" && <p className="rounded bg-red-50 p-2 text-xs text-red-700">{m.error}</p>}

      {s && (
        <div className="space-y-3">
          {s.resumo && <p className="text-sm">{s.resumo}</p>}
          {s.perfil && <p className="text-xs text-slate-500">{s.perfil}</p>}
          <List title="Dores do cliente" items={s.dores} />
          {!!s.objecoes?.length && (
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">Objeções</p>
              <ul className="space-y-1 text-sm">
                {s.objecoes.map((o, i) => (
                  <li key={i} className="flex gap-2">
                    {o.tratada ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600" /> : <XCircle size={14} className="mt-0.5 shrink-0 text-red-500" />}
                    <span><b>{o.objecao}</b>{o.resposta && <span className="text-slate-500"> — {o.resposta}</span>}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <List title="O que foi combinado" items={s.combinado} />
          {s.proximoPasso && <p className="rounded-lg bg-emerald-50 p-2 text-sm"><b>Próximo passo:</b> {s.proximoPasso}</p>}
          {!!s.tarefas?.length && <p className="text-xs text-slate-500">{m.tasksCreated} tarefa(s) criada(s) na aba Tarefas: {s.tarefas.map((t) => t.titulo).join(" · ")}</p>}
          {s.avaliacao && (
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Avaliação do atendimento {s.avaliacao.nota != null && <span className="ml-1 text-slate-800">{s.avaliacao.nota}/10</span>}</p>
              {s.avaliacao.etapas && (
                <div className="mb-2 grid grid-cols-5 gap-1 text-center text-[11px]">
                  {Object.entries(ETAPA).map(([k, label]) => {
                    const v = s.avaliacao?.etapas?.[k];
                    return (
                      <div key={k} className="rounded bg-white p-1">
                        <p className="text-slate-500">{label}</p>
                        <p className="font-semibold" style={{ color: v == null ? "#94A3B8" : v >= 7 ? "#059669" : v >= 5 ? "#D97706" : "#DC2626" }}>{v ?? "—"}</p>
                      </div>
                    );
                  })}
                </div>
              )}
              <List title="Pontos fortes" items={s.avaliacao.pontosFortes} />
              <List title="O que melhorar" items={s.avaliacao.melhorar} />
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t pt-2 text-xs">
        {m.hasTranscript && <button className="text-secondary underline" onClick={() => setShowT((v) => !v)}>{showT ? "Ocultar transcrição" : "Ver transcrição"}</button>}
        {m.hasFile && <a className="flex items-center gap-1 text-slate-500 hover:text-slate-700" href={`/api/meetings/${m.id}/file`}><Download size={12} /> Gravação</a>}
        {(m.status === "FAILED" || m.status === "DONE") && <button className="flex items-center gap-1 text-slate-500 hover:text-slate-700" onClick={() => retry.mutate()}><RotateCcw size={12} /> Reprocessar</button>}
        <button className="ml-auto flex items-center gap-1 text-red-500 hover:text-red-700" onClick={() => confirm("Apagar esta reunião, a gravação e a transcrição?") && del.mutate()}><Trash2 size={12} /> Apagar</button>
      </div>
      {showT && <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs">{full.data?.transcript ?? "Carregando…"}</pre>}
    </div>
  );
}
