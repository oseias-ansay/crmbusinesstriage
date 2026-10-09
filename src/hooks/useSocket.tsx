"use client";
/**
 * Conexão Socket.io única por aba + hook para assinar eventos.
 * O cookie de sessão autentica o socket (ver server.ts).
 */
import { createContext, useContext, useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";

const SocketCtx = createContext<Socket | null>(null);

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  useEffect(() => {
    const s = io({ path: "/socket.io", withCredentials: true, transports: ["websocket", "polling"] });
    setSocket(s);
    return () => {
      s.disconnect();
    };
  }, []);
  return <SocketCtx.Provider value={socket}>{children}</SocketCtx.Provider>;
}

export const useSocket = () => useContext(SocketCtx);

export function useSocketEvent<T = unknown>(event: string, handler: (data: T) => void) {
  const socket = useSocket();
  useEffect(() => {
    if (!socket) return;
    socket.on(event, handler);
    return () => {
      socket.off(event, handler);
    };
  }, [socket, event, handler]);
}
