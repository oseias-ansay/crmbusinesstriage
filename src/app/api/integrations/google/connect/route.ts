/** GET — leva o administrador à tela de autorização do Google. */
import { SignJWT } from "jose";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db";
import { tenants } from "@/db/schema";
import { ApiError, route } from "@/lib/api";
import { authUrl } from "@/lib/google/calendar";
import { googleRedirectUri } from "@/lib/google/redirect";

const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-secret-change-me");

export const GET = route(async (req, { auth }) => {
  const g = await withTenant(auth.tenantId, async (tx) => (await tx.select({ s: tenants.settings }).from(tenants).where(eq(tenants.id, auth.tenantId)))[0].s.google);
  if (!g?.clientId || !g.clientSecret) throw new ApiError(422, "Preencha o Client ID e o Client Secret antes de conectar");
  const state = await new SignJWT({ t: auth.tenantId, u: auth.userId }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("10m").sign(secret());
  return NextResponse.redirect(authUrl(g, googleRedirectUri(req), state));
}, { minRole: "ADMIN" });
