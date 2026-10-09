/** Conexões de canal do tenant (instâncias WhatsApp, página Instagram, caixa de e-mail). */
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { withTenant } from "@/db";
import { channelConnections } from "@/db/schema";
import { parseBody, route } from "@/lib/api";

export const GET = route(async (_req, { auth }) =>
  withTenant(auth.tenantId, async (tx) => {
    const rows = await tx.select().from(channelConnections).where(eq(channelConnections.tenantId, auth.tenantId));
    // nunca devolve tokens completos ao navegador
    return rows.map((r) => ({ ...r, config: { webhookToken: r.config.webhookToken, hasAccessToken: !!r.config.pageAccessToken } }));
  }),
  { minRole: "ADMIN" },
);

const schema = z.object({
  channel: z.enum(["WHATSAPP", "INSTAGRAM", "EMAIL"]),
  name: z.string().min(2),
  externalId: z.string().min(1), // instância Evolution / id da página / e-mail
  pageAccessToken: z.string().optional(),
});

export const POST = route(async (req, { auth }) => {
  const b = await parseBody(req, schema);
  return withTenant(auth.tenantId, async (tx) => {
    const [c] = await tx
      .insert(channelConnections)
      .values({
        tenantId: auth.tenantId,
        channel: b.channel,
        name: b.name,
        externalId: b.externalId,
        config: { webhookToken: randomBytes(16).toString("hex"), ...(b.pageAccessToken && { pageAccessToken: b.pageAccessToken }) },
      })
      .returning();
    return c;
  });
}, { minRole: "ADMIN" });
