/**
 * POST /api/upload (multipart: file, dealId?, contactId?)
 * Salva em disco (UPLOAD_DIR/<tenantId>/...) e, se vinculado, cria Attachment.
 * Em produção com várias instâncias, troque por S3/Cloudflare R2.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { withTenant } from "@/db";
import { attachments } from "@/db/schema";
import { ApiError, route } from "@/lib/api";
import { logActivity } from "@/lib/activity";

const MAX = 16 * 1024 * 1024; // 16 MB (limite do WhatsApp para mídia)
const ALLOWED = /^(image\/|audio\/|video\/|application\/pdf|application\/vnd\.|application\/msword|text\/csv|text\/plain)/;

export const POST = route(async (req, { auth }) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "Arquivo ausente");
  if (file.size > MAX) throw new ApiError(413, "Arquivo maior que 16 MB");
  if (!ALLOWED.test(file.type)) throw new ApiError(415, "Tipo de arquivo não permitido");

  const ext = path.extname(file.name).replace(/[^.\w]/g, "").slice(0, 8);
  const rel = `${auth.tenantId}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}${ext}`;
  const base = path.resolve(process.env.UPLOAD_DIR ?? "./data/uploads");
  await mkdir(path.dirname(path.join(base, rel)), { recursive: true });
  await writeFile(path.join(base, rel), Buffer.from(await file.arrayBuffer()));
  const url = `/uploads/${rel}`;

  const dealId = (form.get("dealId") as string) || null;
  const contactId = (form.get("contactId") as string) || null;
  if (dealId || contactId) {
    await withTenant(auth.tenantId, async (tx) => {
      await tx.insert(attachments).values({ tenantId: auth.tenantId, dealId, contactId, fileName: file.name, url, mimeType: file.type, sizeBytes: file.size });
      await logActivity(tx, { tenantId: auth.tenantId, type: "FILE", summary: `Arquivo anexado: ${file.name}`, dealId, contactId, userId: auth.userId });
    });
  }
  return { url, fileName: file.name, mimeType: file.type, size: file.size };
});
