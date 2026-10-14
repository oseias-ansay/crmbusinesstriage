/** GET → baixa a gravação original (só usuários logados do próprio tenant). */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db";
import { meetingRecords } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { UPLOAD_BASE } from "@/lib/meetings/process";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return new Response("Não autenticado", { status: 401 });
  const { id } = await params;
  const [m] = await withTenant(auth.tenantId, (tx) => tx.select().from(meetingRecords).where(and(eq(meetingRecords.id, id), eq(meetingRecords.tenantId, auth.tenantId))).limit(1));
  if (!m?.filePath) return new Response("Arquivo não disponível (apagado pela retenção ou inexistente)", { status: 404 });
  const abs = path.join(UPLOAD_BASE(), m.filePath);
  const st = await stat(abs).catch(() => null);
  if (!st) return new Response("Arquivo não encontrado", { status: 404 });
  return new Response(Readable.toWeb(createReadStream(abs)) as ReadableStream, {
    headers: {
      "Content-Type": m.mimeType || "application/octet-stream",
      "Content-Length": String(st.size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(m.fileName)}`,
    },
  });
}
