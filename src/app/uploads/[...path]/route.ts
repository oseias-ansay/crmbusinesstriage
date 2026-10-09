/**
 * GET /uploads/<tenantId>/<aaaa-mm>/<uuid>.<ext>
 * Serve os arquivos enviados (UPLOAD_DIR) — necessário no Docker, onde não há
 * Nginx servindo o disco. Nomes são UUID aleatórios (não adivinháveis), o que
 * permite à Evolution API baixar a mídia ao enviar no WhatsApp.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".oga": "audio/ogg", ".webm": "audio/webm", ".m4a": "audio/mp4", ".wav": "audio/wav",
  ".mp4": "video/mp4", ".mov": "video/quicktime",
  ".pdf": "application/pdf", ".csv": "text/csv", ".txt": "text/plain",
  ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const parts = (await params).path;
  // Só aceita segmentos simples (sem "..", barras ou caracteres estranhos)
  if (!parts.length || parts.some((p) => !/^[\w.-]+$/.test(p) || p.startsWith("."))) {
    return new Response("Not found", { status: 404 });
  }
  const base = path.resolve(process.env.UPLOAD_DIR ?? "./data/uploads");
  const file = path.resolve(base, ...parts);
  if (!file.startsWith(base + path.sep)) return new Response("Not found", { status: 404 });

  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error();
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] ?? "application/octet-stream";
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
      headers: {
        "Content-Type": type,
        "Content-Length": String(st.size),
        "Cache-Control": "public, max-age=2592000, immutable",
        "X-Content-Type-Options": "nosniff",
        // SVG/HTML nunca executam scripts a partir daqui
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
        ...(type === "application/octet-stream" && { "Content-Disposition": "attachment" }),
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
