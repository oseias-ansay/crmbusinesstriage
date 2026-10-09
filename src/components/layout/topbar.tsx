"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, LogOut } from "lucide-react";
import { useCallback, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { api } from "@/lib/fetcher";
import { useSocketEvent } from "@/hooks/useSocket";
import { Avatar } from "@/components/ui/avatar";
import { AccountDialog } from "./account-dialog";

type Notif = { id: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string };

export function Topbar({ userName, role }: { userName: string; role: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState(false);
  const { data = [] } = useQuery({ queryKey: ["notifications"], queryFn: () => api<Notif[]>("/api/notifications") });
  const unread = data.filter((n) => !n.readAt).length;

  useSocketEvent(
    "notification:new",
    useCallback(() => qc.invalidateQueries({ queryKey: ["notifications"] }), [qc]),
  );

  async function toggle() {
    setOpen((v) => !v);
    if (!open && unread) {
      await api("/api/notifications", { method: "PATCH" });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    }
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-end gap-3 border-b bg-white px-4">
      <div className="relative">
        <button onClick={toggle} className="relative rounded-lg p-2 hover:bg-slate-100" aria-label="Notificações">
          <Bell size={18} />
          {unread > 0 && <span className="absolute right-1 top-1 h-4 min-w-4 rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{unread}</span>}
        </button>
        {open && (
          <div className="absolute right-0 top-11 z-30 w-80 rounded-xl border bg-white shadow-lg">
            <p className="border-b px-4 py-2 text-sm font-semibold">Notificações</p>
            <ul className="max-h-96 overflow-y-auto">
              {data.length === 0 && <li className="p-4 text-sm text-slate-500">Nada por aqui.</li>}
              {data.map((n) => (
                <li key={n.id} className="border-b last:border-0">
                  <Link href={n.link ?? "#"} onClick={() => setOpen(false)} className="block px-4 py-3 hover:bg-slate-50">
                    <p className="text-sm font-medium">{n.title}</p>
                    {n.body && <p className="truncate text-xs text-slate-500">{n.body}</p>}
                    <p className="mt-1 text-[11px] text-slate-400">{formatDistanceToNow(new Date(n.createdAt), { locale: ptBR, addSuffix: true })}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <button onClick={() => setAccount(true)} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-slate-100" title="Minha conta">
        <Avatar name={userName} />
        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium leading-none">{userName}</p>
          <p className="text-[11px] text-slate-500">{role}</p>
        </div>
      </button>
      <AccountDialog open={account} onOpenChange={setAccount} />
      <button
        onClick={async () => {
          await api("/api/auth/logout", { method: "POST" });
          window.location.href = "/login";
        }}
        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
        aria-label="Sair"
      >
        <LogOut size={18} />
      </button>
    </header>
  );
}
