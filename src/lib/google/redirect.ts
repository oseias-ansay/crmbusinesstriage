/** Endereço de retorno do OAuth, a partir do host acessado (cada tenant usa o seu domínio). */
export function googleRedirectUri(req: Request) {
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? u.host;
  const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}/api/integrations/google/callback`;
}
