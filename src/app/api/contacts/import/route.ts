/**
 * POST /api/contacts/import (multipart: file=<csv>)
 * Colunas reconhecidas: nome|name, email, telefone|phone|celular, empresa|company,
 * cargo, origem|source, tags (separadas por vírgula), cf_<campo> → custom field.
 * Deduplica por e-mail ou telefone dentro do tenant.
 */
import { eq, or } from "drizzle-orm";
import Papa from "papaparse";
import { withTenant } from "@/db";
import { contactTags, contacts, organizations } from "@/db/schema";
import { ApiError, route } from "@/lib/api";
import { ensureTags } from "@/lib/services/deals";
import { normalizePhone } from "@/lib/utils";

const pick = (row: Record<string, string>, ...keys: string[]) => {
  for (const k of keys) {
    const v = row[k] ?? row[k.toUpperCase()];
    if (v?.trim()) return v.trim();
  }
  return null;
};

export const POST = route(async (req, { auth }) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "Envie o arquivo CSV no campo 'file'");
  const text = (await file.text()).replace(/^﻿/, "");
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase() });
  if (parsed.data.length > 20_000) throw new ApiError(413, "Máximo de 20.000 linhas por importação");

  const result = { created: 0, updated: 0, skipped: 0, errors: [] as string[] };

  await withTenant(auth.tenantId, async (tx) => {
    const orgCache = new Map<string, string>();
    for (const [i, row] of parsed.data.entries()) {
      const name = pick(row, "nome", "name");
      const email = pick(row, "email", "e-mail")?.toLowerCase() ?? null;
      const phone = normalizePhone(pick(row, "telefone", "phone", "celular", "whatsapp"));
      if (!name || (!email && !phone)) {
        result.skipped++;
        result.errors.push(`Linha ${i + 2}: nome e (email ou telefone) obrigatórios`);
        continue;
      }
      const customFields = Object.fromEntries(Object.entries(row).filter(([k, v]) => k.startsWith("cf_") && v).map(([k, v]) => [k.slice(3), v]));

      let organizationId: string | null = null;
      const company = pick(row, "empresa", "company", "organização");
      if (company) {
        organizationId = orgCache.get(company) ?? null;
        if (!organizationId) {
          const [o] = await tx.insert(organizations).values({ tenantId: auth.tenantId, name: company }).returning();
          organizationId = o.id;
          orgCache.set(company, o.id);
        }
      }

      const conds = [email && eq(contacts.email, email), phone && eq(contacts.phone, phone)].filter(Boolean) as ReturnType<typeof eq>[];
      const [existing] = await tx.select().from(contacts).where(or(...conds)).limit(1);
      let contactId: string;
      if (existing) {
        await tx
          .update(contacts)
          .set({ name, email: email ?? existing.email, phone: phone ?? existing.phone, organizationId: organizationId ?? existing.organizationId, customFields: { ...existing.customFields, ...customFields } })
          .where(eq(contacts.id, existing.id));
        contactId = existing.id;
        result.updated++;
      } else {
        const [c] = await tx
          .insert(contacts)
          .values({ tenantId: auth.tenantId, name, email, phone, organizationId, jobTitle: pick(row, "cargo"), source: pick(row, "origem", "source") ?? "importação", ownerId: auth.userId, customFields })
          .returning();
        contactId = c.id;
        result.created++;
      }

      const tagList = pick(row, "tags")?.split(",").map((t) => t.trim()).filter(Boolean) ?? [];
      if (tagList.length) {
        const tg = await ensureTags(tx, auth.tenantId, tagList);
        await tx.insert(contactTags).values(tg.map((t) => ({ tenantId: auth.tenantId, contactId, tagId: t.id }))).onConflictDoNothing();
      }
    }
  });
  return result;
});
