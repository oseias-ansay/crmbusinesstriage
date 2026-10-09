/** GET /api/contacts/export?<mesmos filtros da listagem> → CSV (UTF-8 com BOM p/ Excel) */
import { and, desc, eq } from "drizzle-orm";
import Papa from "papaparse";
import { withTenant } from "@/db";
import { contacts, organizations } from "@/db/schema";
import { route } from "@/lib/api";
import { contactFilters } from "@/lib/filters";

export const GET = route(async (req, { auth }) => {
  const sp = new URL(req.url).searchParams;
  const rows = await withTenant(auth.tenantId, (tx) =>
    tx
      .select({ c: contacts, org: organizations.name })
      .from(contacts)
      .leftJoin(organizations, eq(organizations.id, contacts.organizationId))
      .where(and(...contactFilters(auth.tenantId, sp)))
      .orderBy(desc(contacts.createdAt))
      .limit(50_000),
  );
  const cfKeys = [...new Set(rows.flatMap((r) => Object.keys(r.c.customFields ?? {})))];
  const csv = Papa.unparse(
    rows.map(({ c, org }) => ({
      nome: c.name,
      email: c.email ?? "",
      telefone: c.phone ?? "",
      empresa: org ?? "",
      cargo: c.jobTitle ?? "",
      origem: c.source ?? "",
      criado_em: c.createdAt.toISOString(),
      ...Object.fromEntries(cfKeys.map((k) => [`cf_${k}`, String((c.customFields as Record<string, unknown>)[k] ?? "")])),
    })),
    { delimiter: ";" },
  );
  return new Response("﻿" + csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="contatos-${Date.now()}.csv"` },
  });
});
