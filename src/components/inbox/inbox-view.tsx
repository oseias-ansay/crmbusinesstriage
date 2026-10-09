"use client";
/**
 * ════════════════════════════════════════════════════════════════════
 *  Central Unificada de Comunicação (Omnichannel Inbox)
 * ════════════════════════════════════════════════════════════════════
 *  Coluna 1: conversas (WhatsApp, Instagram, E-mail, Interno) com filtros
 *  Coluna 2: chat — texto, mídia, documentos, áudio gravado no navegador,
 *            respostas rápidas ("/atalho") e notas internas
 *  Coluna 3: contexto do lead — contato, negócio, atribuição e status
 *  Tudo sincronizado em tempo real via Socket.io.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isToday } from "date-fns";
import { Check, CheckCheck, Instagram, Lock, Mail, MessageCircle, Mic, Paperclip, Search, Send, Square, Users, Zap, AlertCircle } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/fetcher";
import { cn, renderTemplate } from "@/lib/utils";
import { useSocket, useSocketEvent } from "@/hooks/useSocket";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

type Channel = "WHATSAPP" | "INSTAGRAM" | "EMAIL" | "INTERNAL" | "WEBCHAT";
type Conv = {
  id: string; channel: Channel; status: "OPEN" | "PENDING" | "RESOLVED"; unreadCount: number; lastMessageAt: string; lastMessagePreview: string | null;
  assignedToId: string | null; assignedToName: string | null; dealId: string | null; dealTitle: string | null;
  contact: { id: string; name: string; phone: string | null; email: string | null };
};
type Msg = {
  id: string; conversationId: string; senderType: "CONTACT" | "USER" | "BOT" | "SYSTEM"; type: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT";
  content: string; mediaUrl: string | null; status: string; isInternalNote: boolean; timestamp: string; userName?: string | null;
};
type QuickReply = { id: string; shortcut: string; title: string; content: string };
type TeamUser = { id: string; name: string };

const CHANNEL_ICON: Record<Channel, { icon: typeof Mail; color: string; label: string }> = {
  WHATSAPP: { icon: MessageCircle, color: "#22C55E", label: "WhatsApp" },
  INSTAGRAM: { icon: Instagram, color: "#E1306C", label: "Instagram" },
  EMAIL: { icon: Mail, color: "#3B82F6", label: "E-mail" },
  INTERNAL: { icon: Users, color: "#64748B", label: "Interno" },
  WEBCHAT: { icon: MessageCircle, color: "#8B5CF6", label: "Webchat" },
};

function ChannelBadge({ channel }: { channel: Channel }) {
  const c = CHANNEL_ICON[channel];
  return <c.icon size={14} style={{ color: c.color }} aria-label={c.label} />;
}

export function InboxView({ me }: { me: string }) {
  const qc = useQueryClient();
  const socket = useSocket();
  const [tab, setTab] = useState<"all" | "mine" | "queue">("all");
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState("OPEN");
  const [q, setQ] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  const qs = new URLSearchParams({ status, ...(channel && { channel }), ...(q && { q }), ...(tab === "mine" && { mine: "1" }), ...(tab === "queue" && { unassigned: "1" }) }).toString();
  const { data: convs = [] } = useQuery({ queryKey: ["conversations", qs], queryFn: () => api<Conv[]>(`/api/conversations?${qs}`) });
  const { data: team = [] } = useQuery({ queryKey: ["users"], queryFn: () => api<TeamUser[]>("/api/users") });
  const active = convs.find((c) => c.id === activeId) ?? null;

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("c");
    if (id) setActiveId(id);
  }, []);

  // Entrar na sala da conversa (indicador "digitando")
  useEffect(() => {
    if (!socket || !activeId) return;
    socket.emit("conversation:join", activeId);
    return () => {
      socket.emit("conversation:leave", activeId);
    };
  }, [socket, activeId]);

  const onNewMessage = useCallback(
    (p: { conversationId: string; message: Msg }) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.setQueryData<Msg[]>(["messages", p.conversationId], (old) => (old && !old.some((m) => m.id === p.message.id) ? [...old, p.message] : old));
    },
    [qc],
  );
  useSocketEvent("message:new", onNewMessage);
  useSocketEvent("conversation:updated", useCallback(() => qc.invalidateQueries({ queryKey: ["conversations"] }), [qc]));

  const updateConv = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown> }) => api(`/api/conversations/${v.id}`, { method: "PATCH", json: v.body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversations"] }),
  });

  function open(c: Conv) {
    setActiveId(c.id);
    if (c.unreadCount) updateConv.mutate({ id: c.id, body: { markRead: true } });
  }

  return (
    <div className="grid h-full grid-cols-[320px_1fr] xl:grid-cols-[320px_1fr_300px]">
      {/* ── Lista ── */}
      <aside className="flex min-h-0 flex-col border-r bg-white">
        <div className="space-y-2 border-b p-3">
          <div className="flex rounded-lg bg-slate-100 p-1 text-sm">
            {(["all", "mine", "queue"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={cn("flex-1 rounded-md py-1", tab === t && "bg-white font-medium shadow-sm")}>
                {t === "all" ? "Todas" : t === "mine" ? "Minhas" : "Fila"}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input className="h-9 pl-8" placeholder="Buscar contato…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Select className="h-8 flex-1 text-xs" value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="">Todos os canais</option>
              {Object.entries(CHANNEL_ICON).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
            <Select className="h-8 flex-1 text-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="OPEN">Abertas</option><option value="PENDING">Pendentes</option><option value="RESOLVED">Resolvidas</option><option value="ALL">Todas</option>
            </Select>
          </div>
        </div>
        <ul className="scroll-thin flex-1 overflow-y-auto">
          {convs.map((c) => (
            <li key={c.id}>
              <button onClick={() => open(c)} className={cn("flex w-full gap-3 border-b px-3 py-3 text-left hover:bg-slate-50", c.id === activeId && "bg-secondary/5")}>
                <Avatar name={c.contact.name} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <ChannelBadge channel={c.channel} />
                    <p className="truncate text-sm font-medium">{c.contact.name}</p>
                    <span className="ml-auto shrink-0 text-[11px] text-slate-400">{isToday(new Date(c.lastMessageAt)) ? format(new Date(c.lastMessageAt), "HH:mm") : format(new Date(c.lastMessageAt), "dd/MM")}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="truncate text-xs text-slate-500">{c.lastMessagePreview ?? "…"}</p>
                    {c.unreadCount > 0 && <span className="ml-auto rounded-full bg-secondary px-1.5 text-[10px] font-bold text-secondary-foreground">{c.unreadCount}</span>}
                  </div>
                  {!c.assignedToId && <span className="text-[10px] font-medium uppercase text-amber-600">na fila</span>}
                </div>
              </button>
            </li>
          ))}
          {convs.length === 0 && <li className="p-6 text-center text-sm text-slate-500">Nenhuma conversa.</li>}
        </ul>
      </aside>

      {/* ── Chat ── */}
      {active ? <ChatPane key={active.id} conv={active} me={me} /> : <div className="flex items-center justify-center text-sm text-slate-400">Selecione uma conversa</div>}

      {/* ── Contexto ── */}
      {active && (
        <aside className="hidden space-y-4 overflow-y-auto border-l bg-white p-4 xl:block">
          <div className="text-center">
            <Avatar name={active.contact.name} size={56} className="mx-auto" />
            <p className="mt-2 font-semibold">{active.contact.name}</p>
            <p className="text-xs text-slate-500">{active.contact.phone ?? active.contact.email}</p>
            <Link href={`/contacts/${active.contact.id}`} className="text-xs text-primary underline">Ver visão 360°</Link>
          </div>
          {active.dealId && (
            <Link href={`/pipeline?deal=${active.dealId}`} className="block rounded-lg border p-3 text-sm hover:bg-slate-50">
              <p className="text-xs text-slate-500">Negócio vinculado</p>
              <p className="font-medium">{active.dealTitle}</p>
            </Link>
          )}
          <div>
            <p className="mb-1 text-xs font-medium text-slate-600">Responsável</p>
            <Select className="w-full" value={active.assignedToId ?? ""} onChange={(e) => updateConv.mutate({ id: active.id, body: { assignedToId: e.target.value || null } })}>
              <option value="">— Fila (sem responsável) —</option>
              {team.map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === me ? " (eu)" : ""}</option>)}
            </Select>
            {active.assignedToId !== me && (
              <Button size="sm" variant="outline" className="mt-2 w-full" onClick={() => updateConv.mutate({ id: active.id, body: { assignedToId: me } })}>Assumir conversa</Button>
            )}
          </div>
          <div className="flex gap-2">
            {active.status !== "RESOLVED" ? (
              <Button size="sm" className="flex-1" onClick={() => updateConv.mutate({ id: active.id, body: { status: "RESOLVED" } })}><Check size={14} /> Resolver</Button>
            ) : (
              <Button size="sm" variant="outline" className="flex-1" onClick={() => updateConv.mutate({ id: active.id, body: { status: "OPEN" } })}>Reabrir</Button>
            )}
            <Button size="sm" variant="outline" className="flex-1" onClick={() => updateConv.mutate({ id: active.id, body: { status: "PENDING" } })}>Pendente</Button>
          </div>
        </aside>
      )}
    </div>
  );
}

function ChatPane({ conv, me }: { conv: Conv; me: string }) {
  const qc = useQueryClient();
  const socket = useSocket();
  const key = ["messages", conv.id];
  const { data: msgs = [] } = useQuery({ queryKey: key, queryFn: () => api<Msg[]>(`/api/conversations/${conv.id}/messages`) });
  const { data: quick = [] } = useQuery({ queryKey: ["quick-replies"], queryFn: () => api<QuickReply[]>("/api/quick-replies") });
  const [text, setText] = useState("");
  const [internal, setInternal] = useState(false);
  const [typing, setTyping] = useState(false);
  const [recording, setRecording] = useState<MediaRecorder | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [msgs.length]);

  useSocketEvent(
    "conversation:typing",
    useCallback((p: { id: string; userId: string }) => {
      if (p.id !== conv.id || p.userId === me) return;
      setTyping(true);
      setTimeout(() => setTyping(false), 2500);
    }, [conv.id, me]),
  );

  const send = useMutation({
    mutationFn: (body: { content: string; type?: Msg["type"]; mediaUrl?: string; mediaMime?: string; isInternalNote?: boolean }) =>
      api<Msg>(`/api/conversations/${conv.id}/messages`, { method: "POST", json: body }),
    onSuccess: (m) => {
      qc.setQueryData<Msg[]>(key, (old = []) => (old.some((x) => x.id === m.id) ? old.map((x) => (x.id === m.id ? m : x)) : [...old, m]));
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  // Respostas rápidas: digitar "/" abre sugestões
  const suggestions = useMemo(() => (text.startsWith("/") ? quick.filter((r) => r.shortcut.startsWith(text.split(" ")[0])) : []), [text, quick]);

  function submit() {
    if (!text.trim()) return;
    send.mutate({ content: text, isInternalNote: internal });
    setText("");
  }

  async function uploadAndSend(file: File | Blob, name: string) {
    const fd = new FormData();
    fd.append("file", file, name);
    const up = await api<{ url: string; mimeType: string }>("/api/upload", { method: "POST", body: fd });
    const type: Msg["type"] = up.mimeType.startsWith("image/") ? "IMAGE" : up.mimeType.startsWith("audio/") ? "AUDIO" : up.mimeType.startsWith("video/") ? "VIDEO" : "DOCUMENT";
    send.mutate({ content: type === "DOCUMENT" ? name : "", type, mediaUrl: up.url, mediaMime: up.mimeType });
  }

  async function toggleRecord() {
    if (recording) {
      recording.stop();
      setRecording(null);
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("audio/ogg") ? "audio/ogg" : "audio/webm" });
    const chunks: BlobPart[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: rec.mimeType });
      uploadAndSend(blob, `audio-${Date.now()}.${rec.mimeType.includes("ogg") ? "ogg" : "webm"}`);
    };
    rec.start();
    setRecording(rec);
  }

  return (
    <section className="flex min-h-0 flex-col bg-slate-50">
      <header className="flex items-center gap-3 border-b bg-white px-4 py-3">
        <ChannelBadge channel={conv.channel} />
        <p className="font-medium">{conv.contact.name}</p>
        <span className="text-xs text-slate-500">{conv.assignedToName ? `com ${conv.assignedToName}` : "sem responsável"}</span>
      </header>

      <div className="scroll-thin flex-1 space-y-2 overflow-y-auto p-4">
        {msgs.map((m) => {
          const mine = m.senderType !== "CONTACT";
          return (
            <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[70%] rounded-2xl px-3 py-2 text-sm shadow-sm",
                  m.isInternalNote ? "border border-amber-300 bg-amber-50" : mine ? "bg-primary text-primary-foreground" : "bg-white",
                )}
              >
                {m.isInternalNote && <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase text-amber-700"><Lock size={10} /> Nota interna</p>}
                {m.senderType === "BOT" && <p className="mb-1 text-[10px] font-semibold uppercase opacity-70">🤖 Bot do CRM</p>}
                {m.senderType === "SYSTEM" && <p className="mb-1 text-[10px] font-semibold uppercase opacity-70">↗ Enviado pelo WhatsApp (n8n / celular)</p>}
                {m.type === "IMAGE" && m.mediaUrl && <img src={m.mediaUrl} alt="" className="mb-1 max-h-64 rounded-lg" />}
                {m.type === "AUDIO" && m.mediaUrl && <audio controls src={m.mediaUrl} className="mb-1 max-w-full" />}
                {m.type === "VIDEO" && m.mediaUrl && <video controls src={m.mediaUrl} className="mb-1 max-h-64 rounded-lg" />}
                {m.type === "DOCUMENT" && m.mediaUrl && <a href={m.mediaUrl} target="_blank" className="mb-1 flex items-center gap-1 underline"><Paperclip size={12} /> {m.content || "Documento"}</a>}
                {m.content && m.type !== "DOCUMENT" && <p className="whitespace-pre-wrap">{m.content}</p>}
                <p className={cn("mt-1 flex items-center justify-end gap-1 text-[10px]", mine && !m.isInternalNote ? "text-primary-foreground/70" : "text-slate-400")}>
                  {m.userName && `${m.userName} · `}
                  {format(new Date(m.timestamp), "HH:mm")}
                  {mine && !m.isInternalNote && (m.status === "FAILED" ? <AlertCircle size={12} className="text-red-300" /> : m.status === "READ" ? <CheckCheck size={12} /> : <Check size={12} />)}
                </p>
              </div>
            </div>
          );
        })}
        {typing && <p className="text-xs italic text-slate-400">Outro atendente está digitando…</p>}
        <div ref={endRef} />
      </div>

      <footer className="relative border-t bg-white p-3">
        {suggestions.length > 0 && (
          <ul className="absolute bottom-full left-3 right-3 mb-2 max-h-56 overflow-y-auto rounded-xl border bg-white shadow-lg">
            {suggestions.map((r) => (
              <li key={r.id}>
                <button className="w-full px-4 py-2 text-left hover:bg-slate-50" onClick={() => setText(renderTemplate(r.content, { contact: conv.contact }))}>
                  <p className="text-sm font-medium"><Zap size={12} className="mr-1 inline text-secondary" />{r.shortcut} · {r.title}</p>
                  <p className="truncate text-xs text-slate-500">{r.content}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mb-2 flex gap-2 text-xs">
          <button onClick={() => setInternal(false)} className={cn("rounded-full px-3 py-1", !internal ? "bg-primary text-primary-foreground" : "bg-slate-100")}>Responder</button>
          <button onClick={() => setInternal(true)} className={cn("flex items-center gap-1 rounded-full px-3 py-1", internal ? "bg-amber-500 text-white" : "bg-slate-100")}><Lock size={11} /> Nota interna</button>
        </div>
        <div className="flex items-end gap-2">
          <label className="cursor-pointer rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Anexar">
            <Paperclip size={18} />
            <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && uploadAndSend(e.target.files[0], e.target.files[0].name)} />
          </label>
          <textarea
            rows={1}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              socket?.emit("conversation:typing", conv.id);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={internal ? "Escreva uma nota para a equipe…" : "Digite uma mensagem ou / para respostas rápidas"}
            className={cn("max-h-40 min-h-[40px] flex-1 resize-none rounded-lg border px-3 py-2 text-sm outline-none focus:border-primary", internal && "bg-amber-50")}
          />
          <button onClick={toggleRecord} className={cn("rounded-lg p-2", recording ? "bg-red-500 text-white" : "text-slate-500 hover:bg-slate-100")} aria-label="Gravar áudio">
            {recording ? <Square size={18} /> : <Mic size={18} />}
          </button>
          <Button size="icon" onClick={submit} disabled={!text.trim() || send.isPending} aria-label="Enviar"><Send size={16} /></Button>
        </div>
      </footer>
    </section>
  );
}
