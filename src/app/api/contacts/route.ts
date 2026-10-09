/**
 * GET  /api/contacts?q=&tag=&ownerId=&source=&cf.<campo>=<valor>&page=&pageSize=
 *      Busca + filtros avançados (inclusive por campos personalizados JSONB)
 * POST /api/contacts
 */
import { and, count, desc, eq, sql } from "drizzle-orm";
import { contactFilters } from "@/lib/filters";
import { withTenant } from "@/db";
import { contactTags, contacts, organizations, tags, tenants, users } from "@/db/schema";
import { ApiError, parseBody, route } from "@/lib/api";
import { contactSchema } from "@/lib/validators";
import { ensureTags } from "@/lib/services/deals";
import { normalizePhone } from "@/lib/utils";

export const GET = route(async (req, { auth }) => {
  const sp = new URL(req.url).searchParams;
  const page = Math.max(1, Number(sp.get("page") ?? 1));
  const pageSize = Math.min(100, Number(sp.get("pageSize") ?? 25));
  const where = and(...contactFilters(auth.tenantId, sp));

  return withTenant(auth.tenantId, async (tx) => {
    const [{ total }] = await tx.select({ total: count() }).from(contacts).where(where);
    const rows = await tx
      .select({
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
        phone: contacts.phone,
        source: contacts.source,
        customFields: contacts.customFields,
        createdAt: contacts.createdAt,
        organization: organizations.name,
        owner: users.name,
        tags: sql<{ name: string; color: string }[]>`coalesce((select json_agg(json_build_object('name', tg.name, 'color', tg.color)) from ${contactTags} ct join ${tags} tg on tg.id = ct.tag_id where ct.contact_id = ${contacts.id}), '[]'::json)`,
      })
      .from(contacts)
      .leftJoin(organizations, eq(organizations.id, contacts.organizationId))
      .leftJoin(users, eq(users.id, contacts.ownerId))
      .where(where)
      .orderBy(desc(contacts.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return { data: rows, total, page, pageSize };
  });
});

export const POST = route(async (req, { auth }) => {
  const body = await parseBody(req, contactSchema);
  return withTenant(auth.tenantId, async (tx) => {
    // Limite do plano
    const [t] = await tx.select({ max: tenants.maxContacts }).from(tenants).where(eq(tenants.id, auth.tenantId));
    const [{ n }] = await tx.select({ n: count() }).from(contacts);
    if (n >= t.max) throw new ApiError(402, `Limite de ${t.max} contatos do plano atingido`);

    const { tags: tagNames, ...data } = body;
    const [c] = await tx
      .insert(contacts)
      .values({ ...data, email: data.email || null, phone: normalizePhone(data.phone), tenantId: auth.tenantId, ownerId: data.ownerId ?? auth.userId })
      .returning();
    if (tagNames?.length) {
      const tg = await ensureTags(tx, auth.tenantId, tagNames);
      await tx.insert(contactTags).values(tg.map((x) => ({ tenantId: auth.tenantId, contactId: c.id, tagId: x.id })));
    }
    return Response.json(c, { status: 201 });
  });
});
