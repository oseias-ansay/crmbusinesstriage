/**
 * ════════════════════════════════════════════════════════════════════
 *  Servidor customizado: Next.js + Socket.io + Worker no mesmo processo
 * ════════════════════════════════════════════════════════════════════
 *  - HTTP do Next (páginas + API)
 *  - WebSocket autenticado pelo mesmo cookie JWT da sessão
 *  - Cada socket entra nas salas tenant:<id> e user:<id>
 *  - Worker de automações agendadas e lembretes de tarefas
 *
 *  Rodar: npm run dev  |  produção: npm run build && npm start (PM2)
 */
import "dotenv/config";
import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
import { parse as parseCookie } from "./src/lib/cookie";
import { SESSION_COOKIE, verifySession } from "./src/lib/session";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3100);
// Escuta só em localhost: o acesso externo passa obrigatoriamente pelo Nginx
const hostname = process.env.HOST ?? "127.0.0.1";
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  const httpServer = createServer((req, res) => handle(req, res));

  const io = new Server(httpServer, {
    path: "/socket.io",
    cors: { origin: true, credentials: true },
  });
  (globalThis as unknown as { __io: Server }).__io = io;

  // Autenticação do socket com o cookie de sessão
  io.use(async (socket, nextFn) => {
    const cookies = parseCookie(socket.handshake.headers.cookie ?? "");
    const session = await verifySession(cookies[SESSION_COOKIE]);
    if (!session) return nextFn(new Error("unauthorized"));
    socket.data.session = session;
    nextFn();
  });

  io.on("connection", (socket) => {
    const s = socket.data.session as { sub: string; tid: string };
    socket.join(`tenant:${s.tid}`);
    socket.join(`user:${s.sub}`);

    // "Fulano está digitando..." e presença no chat
    socket.on("conversation:join", (id: string) => socket.join(`conversation:${id}`));
    socket.on("conversation:leave", (id: string) => socket.leave(`conversation:${id}`));
    socket.on("conversation:typing", (id: string) => socket.to(`conversation:${id}`).emit("conversation:typing", { id, userId: s.sub }));
  });

  // Worker (desative com DISABLE_WORKER=1 se usar /api/cron/tick externo)
  if (process.env.DISABLE_WORKER !== "1") {
    const { startWorker } = await import("./src/lib/automation/worker");
    startWorker();
  }

  httpServer.listen(port, hostname, () => {
    console.log(`▲ Triage CRM em http://${hostname}:${port} (${dev ? "dev" : "produção"})`);
  });
});
