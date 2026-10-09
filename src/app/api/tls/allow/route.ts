/**
 * Usado por deploy/add-domain.sh para conferir se um domínio pertence a algum tenant
 * antes de emitir o certificado SSL e publicar o site no Nginx.
 * GET /api/tls/allow?domain=crm.cliente.com.br → 200 (permite) | 404 (nega)
 */
import { eq } from "drizzle-orm";
import { withAdmin } from "@/db";
import { tenants } from "@/db/schema";

const ROOT = (process.env.ROOT_DOMAIN ?? "").toLowerCase();

export async function GET(req: Request) {
  const domain = new URL(req.url).searchParams.get("domain")?.toLowerCase();
  if (!domain) return new Response("missing", { status: 400 });

  // Subdomínios do SaaS: <slug>.ROOT_DOMAIN
  if (ROOT && domain.endsWith(`.${ROOT}`)) {
    const slug = domain.slice(0, -(ROOT.length + 1));
    const [t] = await withAdmin((tx) => tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).limit(1));
    return new Response(t ? "ok" : "no", { status: t ? 200 : 404 });
  }
  const [t] = await withAdmin((tx) => tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.domain, domain)).limit(1));
  return new Response(t ? "ok" : "no", { status: t ? 200 : 404 });
}
