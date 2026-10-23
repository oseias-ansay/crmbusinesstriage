"use client";
/**
 * Aba "Conversa" do card: o mesmo chat do Inbox (texto, anexos, áudio, respostas
 * rápidas, nota interna), sem sair do funil. Mostra as conversas do contato —
 * a deste negócio primeiro — e permite iniciar uma conversa de WhatsApp.
 */
import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { api } from "@/lib/fetcher";
import { useSocket, useSocketEvent } from "@/hooks/useSocket";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { ChannelBadge, ChatPane, type Conv, type Msg } from "@/components/inbox/inbox-view";

const LABEL: Record<string, string> = { WHATSAPP: "WhatsApp", INSTAGRAM: "Instagram", EMAIL: "E-mail", INTERNAL: "Interno", WEBCHAT: "Webchat" };

export type DealChats = { me: string; conversations: Conv[]; numbers: { id: string; name: string; suggested: boolean }[]; hasPhone: boolean };
export const dealChatsKey = (dealId: string) => ["deal-conversations", dealId];

export function useDealChats(dealId: string) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: dealChatsKey(dealId), queryFn: () => api<DealChats>(`/api/deals/${dealId}/conversations`) });
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: dealChatsKey(dealId) }), [qc, dealId]);
  useSocketEvent("conversation:updated", refresh);
  useSocketEvent(
    "message:new",
    useCallback(
      (p: { conversationId: string; message: Msg }) => {
        if (!q.data?.conversations.some((c) => c.id === p.conversationId)) return;
        qc.setQueryData<Msg[]>(["messages", p.conversationId], (old) => (old && !old.some((m) => m.id === p.message.id) ? [...old, p.message] : old));
        refresh();
      },
      [q.data, qc, refresh],
    ),
  );
  return q;
}

export function DealChatPanel({ dealId }: { dealId: string }) {
  const qc = useQueryClient();
  const socket = useSocket();
  const { data } = useDealChats(dealId);
  const convs = data?.conversations ?? [];
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = convs.find((c) => c.id === activeId) ?? convs[0] ?? null;
  const [number, setNumber] = useState("");

  // ao abrir: entra na sala (indicador "digitando") e zera os não lidos
  useEffect(() => {
    if (!socket || !active) return;
    socket.emit("conversation:join", active.id);
    return () => {
      socket.emit("conversation:leave", active.id);
    };
  }, [socket, active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (active?.unreadCount) {
      api(`/api/conversations/${active.id}`, { method: "PATCH", json: { markRead: true } }).then(() => {
        qc.invalidateQueries({ queryKey: dealChatsKey(dealId) });
        qc.invalidateQueries({ queryKey: ["conversations"] });
      });
    }
  }, [active?.id, active?.unreadCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = useMutation({
    mutationFn: () => api<{ id: string }>(`/api/deals/${dealId}/conversations`, { method: "POST", json: { connectionId: number || data?.numbers[0]?.id || null } }),
    onSuccess: (c) => {
      setActiveId(c.id);
      qc.invalidateQueries({ queryKey: dealChatsKey(dealId) });
    },
  });

  if (!data) return <p className="pt-6 text-center text-sm text-slate-400">Carregando…</p>;

  const hasWhatsapp = convs.some((c) => c.channel === "WHATSAPP");
  const starter =
    !hasWhatsapp &&
    (data.hasPhone ? (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed p-3 text-sm">
        <MessageCircle size={16} className="text-emerald-600" />
        <span className="text-slate-600">{convs.length ? "Sem conversa de WhatsApp com este contato." : "Nenhuma conversa com este contato ainda."}</span>
        {data.numbers.length > 1 && (
          <Select className="h-8 text-xs" value={number || data.numbers[0].id} onChange={(e) => setNumber(e.target.value)}>
            {data.numbers.map((n) => <option key={n.id} value={n.id}>{n.name}{n.suggested ? " (deste funil)" : ""}</option>)}
          </Select>
        )}
        <Button size="sm" className="ml-auto" onClick={() => start.mutate()} disabled={start.isPending}>Iniciar conversa no WhatsApp</Button>
        {start.error && <p className="w-full text-xs text-red-600">{(start.error as Error).message}</p>}
      </div>
    ) : (
      <p className="rounded-xl border border-dashed p-3 text-center text-sm text-slate-500">Cadastre o telefone (WhatsApp) do contato para conversar por aqui.</p>
    ));

  return (
    <div className="space-y-3 pt-4">
      {convs.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {convs.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveId(c.id)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${c.id === active?.id ? "border-primary bg-primary/5 font-medium" : "text-slate-600"}`}
            >
              <ChannelBadge channel={c.channel} />
              {c.connectionName ?? LABEL[c.channel] ?? c.channel}
              {c.dealId === dealId && <span className="text-[10px] text-slate-400">· este negócio</span>}
              {c.unreadCount > 0 && <span className="rounded-full bg-secondary px-1.5 text-[10px] font-bold text-secondary-foreground">{c.unreadCount}</span>}
            </button>
          ))}
        </div>
      )}
      {starter}
      {active && (
        <div className="flex h-[60vh] min-h-[360px] flex-col overflow-hidden rounded-xl border">
          <ChatPane key={active.id} conv={active} me={data.me} compact />
        </div>
      )}
    </div>
  );
}
