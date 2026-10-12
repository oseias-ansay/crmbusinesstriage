/** Copiloto de vendas do card. GET histórico · POST pergunta · DELETE limpa o histórico. */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db";
import { copilotMessages } from "@/db/schema";
import { parseBody, route } from "@/lib/api";
import { askCopilot, copilotHistory } from "@/lib/copilot/service";

type P = { id: string };

export const GET = route<P>(async (_req, { auth, params }) => copilotHistory(auth.tenantId, params.id));

const schema = z.object({ question: z.string().trim().max(2000).optional(), action: z.string().max(20).optional() });

export const POST = route<P>(async (req, { auth, params }) => {
  const body = await parseBody(req, schema);
  return askCopilot({ tenantId: auth.tenantId, userId: auth.userId, dealId: params.id, ...body });
});

export const DELETE = route<P>(async (_req, { auth, params }) =>
  withTenant(auth.tenantId, async (tx) => {
    await tx.delete(copilotMessages).where(and(eq(copilotMessages.dealId, params.id), eq(copilotMessages.tenantId, auth.tenantId)));
    return { ok: true };
  }),
);
