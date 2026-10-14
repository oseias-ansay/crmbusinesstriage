/**
 * GET  → reuniões do negócio (sem a transcrição completa).
 * POST → envia gravação/transcrição. Corpo = o arquivo (raw, sem multipart, gravado em disco
 *        aos poucos para não estourar a memória). Query: name, title, consent=1.
 *        Gravações ficam em UPLOAD_DIR/.meetings (não são servidas publicamente).
 */
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { and, desc, eq } from "drizzle-orm";
import { withTenant } from "@/db";
import { deals, meetingRecords, tenants, users } from "@/db/schema";
import { ApiError, route } from "@/lib/api";
import { MEDIA_EXT, TEXT_EXT, UPLOAD_BASE, processMeetingInBackground } from "@/lib/meetings/process";

type P = { id: string };
const MAX = 500 * 1024 * 1024;

export const GET = route<P>(async (_req, { auth, params }) =>
  withTenant(auth.tenantId, (tx) =>
    tx
      .select({
        id: meetingRecords.id, title: meetingRecords.title, fileName: meetingRecords.fileName, status: meetingRecords.status, error: meetingRecords.error,
        summary: meetingRecords.summary, durationSec: meetingRecords.durationSec, sizeBytes: meetingRecords.sizeBytes, tasksCreated: meetingRecords.tasksCreated,
        hasFile: meetingRecords.filePath, hasTranscript: meetingRecords.transcript, createdAt: meetingRecords.createdAt, userName: users.name,
      })
      .from(meetingRecords)
      .leftJoin(users, eq(users.id, meetingRecords.userId))
      .where(and(eq(meetingRecords.dealId, params.id), eq(meetingRecords.tenantId, auth.tenantId)))
      .orderBy(desc(meetingRecords.createdAt))
      .then((rows) => rows.map((r) => ({ ...r, hasFile: !!r.hasFile, hasTranscript: !!r.hasTranscript }))),
  ),
);

export const POST = route<P>(async (req, { auth, params }) => {
  const sp = new URL(req.url).searchParams;
  const name = (sp.get("name") ?? "").trim().slice(0, 200);
  if (sp.get("consent") !== "1") throw new ApiError(400, "Confirme que o cliente foi informado e concordou com a gravação.");
  if (!name || !(MEDIA_EXT.test(name) || TEXT_EXT.test(name))) throw new ApiError(415, "Envie áudio/vídeo (mp3, m4a, mp4, wav, webm, ogg…) ou a transcrição (.txt, .vtt, .srt, .docx, .pdf).");
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX) throw new ApiError(413, "Arquivo maior que 500 MB. Envie só o áudio (o Meet/Zoom também exportam o áudio separado).");
  if (!req.body) throw new ApiError(400, "Arquivo vazio");

  const [deal, t] = await withTenant(auth.tenantId, async (tx) => {
    const [d] = await tx.select({ id: deals.id, contactId: deals.contactId }).from(deals).where(and(eq(deals.id, params.id), eq(deals.tenantId, auth.tenantId))).limit(1);
    const [tn] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, auth.tenantId)).limit(1);
    return [d, tn] as const;
  });
  if (!deal) throw new ApiError(404, "Negócio não encontrado");

  const ext = path.extname(name).toLowerCase().replace(/[^.\w]/g, "").slice(0, 8);
  const rel = path.join(".meetings", auth.tenantId, `${randomUUID()}${ext}`);
  const abs = path.join(UPLOAD_BASE(), rel);
  await mkdir(path.dirname(abs), { recursive: true });
  let size = 0;
  const limiter = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      cb(size > MAX ? new Error("Arquivo maior que 500 MB") : null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(req.body as never), limiter, createWriteStream(abs));
  } catch (e) {
    await rm(abs, { force: true });
    throw new ApiError(413, e instanceof Error ? e.message : "Falha no envio");
  }
  if (size < 10) { await rm(abs, { force: true }); throw new ApiError(400, "Arquivo vazio"); }

  const days = t?.settings.ai?.recordingRetentionDays ?? 90;
  const title = (sp.get("title") ?? "").trim().slice(0, 160) || `Reunião de ${new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`;
  const [m] = await withTenant(auth.tenantId, (tx) =>
    tx
      .insert(meetingRecords)
      .values({
        tenantId: auth.tenantId, dealId: deal.id, contactId: deal.contactId, userId: auth.userId, title, fileName: name, filePath: rel,
        mimeType: req.headers.get("content-type"), sizeBytes: size, consent: true, retainUntil: new Date(Date.now() + days * 86_400_000),
      })
      .returning({ id: meetingRecords.id }),
  );
  processMeetingInBackground(auth.tenantId, m.id);
  return { id: m.id };
});
