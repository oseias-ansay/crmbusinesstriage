/**
 * Google Agenda do tenant.
 * GET status · PATCH { clientId?, clientSecret?, calendarId?, calendarName?, createMeet?, inviteContact? } · DELETE desconecta.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db";
import { tenants } from "@/db/schema";
import { parseBody, route } from "@/lib/api";
import { setGoogle } from "@/lib/google/calendar";
import { googleRedirectUri } from "@/lib/google/redirect";

export const GET = route(async (req, { auth }) =>
  withTenant(auth.tenantId, async (tx) => {
    const [t] = await tx.select({ s: tenants.settings }).from(tenants).where(eq(tenants.id, auth.tenantId));
    const g = t.s.google ?? {};
    return {
      clientId: g.clientId ?? "",
      hasSecret: !!g.clientSecret,
      connected: !!g.refreshToken,
      email: g.email ?? null,
      calendarId: g.calendarId ?? "primary",
      calendarName: g.calendarName ?? null,
      createMeet: g.createMeet !== false,
      inviteContact: g.inviteContact !== false,
      redirectUri: googleRedirectUri(req),
    };
  }),
{ minRole: "ADMIN" });

const schema = z.object({
  clientId: z.string().trim().max(200).optional(),
  clientSecret: z.string().trim().max(200).optional(),
  calendarId: z.string().trim().max(300).optional(),
  calendarName: z.string().trim().max(200).optional(),
  createMeet: z.boolean().optional(),
  inviteContact: z.boolean().optional(),
});

export const PATCH = route(async (req, { auth }) => {
  const body = await parseBody(req, schema);
  if (body.clientSecret === "") delete body.clientSecret; // vazio = mantém o atual
  await setGoogle(auth.tenantId, body);
  return { ok: true };
}, { minRole: "ADMIN" });

export const DELETE = route(async (_req, { auth }) => {
  await setGoogle(auth.tenantId, { refreshToken: undefined, email: undefined });
  return { ok: true };
}, { minRole: "ADMIN" });
