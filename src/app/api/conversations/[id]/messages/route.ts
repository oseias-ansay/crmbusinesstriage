/** GET: histórico paginado (?before=<ISO>) · POST: envia mensagem/mídia/nota interna */
import { and, desc, eq, lt } from "drizzle-orm";
import { withTenant } from "@/db";
import { messages, users } from "@/db/schema";
import { parseBody, route } from "@/lib/api";
import { messageSendSchema } from "@/lib/validators";
import { sendOutbound } from "@/lib/services/messages";

type P = { id: string };

export const GET = route<P>(async (req, { auth, params }) => {
  const before = new URL(req.url).searchParams.get("before");
  const rows = await withTenant(auth.tenantId, (tx) =>
    tx
      .select({ m: messages, userName: users.name })
      .from(messages)
      .leftJoin(users, eq(users.id, messages.userId))
      .where(and(eq(messages.conversationId, params.id), before ? lt(messages.timestamp, new Date(before)) : undefined))
      .orderBy(desc(messages.timestamp))
      .limit(50),
  );
  return rows.map((r) => ({ ...r.m, userName: r.userName })).reverse();
});

export const POST = route<P>(async (req, { auth, params }) => {
  const body = await parseBody(req, messageSendSchema);
  return withTenant(auth.tenantId, (tx) =>
    sendOutbound(tx, {
      tenantId: auth.tenantId,
      conversationId: params.id,
      senderType: "USER",
      userId: auth.userId,
      content: body.content ?? "",
      type: body.type,
      mediaUrl: body.mediaUrl,
      mediaMime: body.mediaMime,
      isInternalNote: body.isInternalNote,
    }),
  );
});
