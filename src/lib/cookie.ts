/** Parser mínimo de cookies (usado pelo Socket.io no server.ts). */
export function parse(header: string): Record<string, string> {
  return Object.fromEntries(
    header
      .split(";")
      .map((p) => p.trim().split("="))
      .filter(([k]) => k)
      .map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]),
  );
}
