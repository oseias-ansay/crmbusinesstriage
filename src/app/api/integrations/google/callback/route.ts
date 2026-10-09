/** GET — retorno do Google: troca o código pelo refresh_token e volta para Configurações. */
import { jwtVerify } from "jose";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withAdmin } from "@/db";
import { tenants } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { exchangeCode, setGoogle } from "@/lib/google/calendar";
import { googleRedirectUri } from "@/lib/google/redirect";

const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-secret-change-me");

export async function GET(req: Request) {
  const u = new URL(req.url);
  const back = (msg: string) => {
    const redirect = googleRedirectUri(req).replace("/api/integrations/google/callback", `/settings?google=${encodeURIComponent(msg)}`);
    return NextResponse.redirect(redirect);
  };
  if (u.searchParams.get("error")) return back(`Autorização cancelada (${u.searchParams.get("error")})`);
  try {
    const auth = await getAuth();
    const { payload } = await jwtVerify(u.searchParams.get("state") ?? "", secret());
    if (!auth || payload.t !== auth.tenantId) return back("Sessão diferente da que iniciou a conexão. Entre de novo e repita.");
    const [t] = await withAdmin((tx) => tx.select({ s: tenants.settings }).from(tenants).where(eq(tenants.id, auth.tenantId)).limit(1));
    const g = t.s.google ?? {};
    const tok = await exchangeCode(g, u.searchParams.get("code") ?? "", googleRedirectUri(req));
    if (!tok.refreshToken) return back("O Google não devolveu a autorização permanente. Remova o acesso do CRM na sua conta Google e conecte de novo.");
    await setGoogle(auth.tenantId, { refreshToken: tok.refreshToken, email: tok.email, calendarId: g.calendarId ?? "primary" });
    return back("ok");
  } catch (e) {
    return back(`Erro ao conectar: ${String(e instanceof Error ? e.message : e).slice(0, 150)}`);
  }
}
