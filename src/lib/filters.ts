/** Filtros reutilizáveis (listagem e exportação de contatos). */
import { eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { contactTags, contacts, tags } from "@/db/schema";

export function contactFilters(tenantId: string, sp: URLSearchParams): SQL[] {
  const f: SQL[] = [eq(contacts.tenantId, tenantId)];
  const q = sp.get("q");
  if (q) f.push(or(ilike(contacts.name, `%${q}%`), ilike(contacts.email, `%${q}%`), ilike(contacts.phone, `%${q.replace(/\D/g, "") || q}%`))!);
  if (sp.get("ownerId")) f.push(eq(contacts.ownerId, sp.get("ownerId")!));
  if (sp.get("source")) f.push(eq(contacts.source, sp.get("source")!));
  if (sp.get("tag")) {
    f.push(inArray(contacts.id, sql`(select ${contactTags.contactId} from ${contactTags} join ${tags} on ${tags.id} = ${contactTags.tagId} where ${tags.name} = ${sp.get("tag")})`));
  }
  // Filtros por custom field: ?cf.segmento=Comércio
  for (const [k, v] of sp.entries()) {
    if (k.startsWith("cf.") && v) f.push(sql`${contacts.customFields}->>${k.slice(3)} = ${v}`);
  }
  return f;
}

