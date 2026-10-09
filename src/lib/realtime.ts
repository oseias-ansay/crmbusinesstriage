/**
 * Emissão de eventos em tempo real (Socket.io).
 * O servidor Socket.io é criado em server.ts e guardado em globalThis,
 * então as rotas da API (mesmo processo) conseguem emitir eventos.
 *
 * Salas:
 *   tenant:<id>        → todos os usuários do tenant (Kanban, Inbox)
 *   user:<id>          → notificações pessoais
 *   conversation:<id>  → quem está com o chat aberto
 *
 * Para escalar em vários processos (PM2 cluster), use @socket.io/redis-adapter.
 */
import type { Server } from "socket.io";

export type RealtimeEvent =
  | "deal:created"
  | "deal:updated"
  | "deal:moved"
  | "deal:deleted"
  | "message:new"
  | "message:status"
  | "conversation:updated"
  | "task:updated"
  | "notification:new";

const io = () => (globalThis as unknown as { __io?: Server }).__io;

export function emitToTenant(tenantId: string, event: RealtimeEvent, data: unknown) {
  io()?.to(`tenant:${tenantId}`).emit(event, data);
}

export function emitToUser(userId: string, event: RealtimeEvent, data: unknown) {
  io()?.to(`user:${userId}`).emit(event, data);
}
