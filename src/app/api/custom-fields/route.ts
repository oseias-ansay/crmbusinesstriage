/** GET /api/custom-fields?entity=CONTACT|DEAL|ORGANIZATION — definições dos campos personalizados */
import { and, asc, eq, type SQL } from "drizzle-orm";
import { withTenant } from "@/db";
import { customFieldDefinitions } from "@/db/schema";
import { route } from "@/lib/api";

export const GET = route(async (req, { auth }) => {
  const entity = new URL(req.url).searchParams.get("entity");
  const f: SQL[] = [eq(customFieldDefinitions.tenantId, auth.tenantId)];
  if (entity) f.push(eq(customFieldDefinitions.entity, entity as "CONTACT"));
  return withTenant(auth.tenantId, (tx) =>
    tx.select().from(customFieldDefinitions).where(and(...f)).orderBy(asc(customFieldDefinitions.order), asc(customFieldDefinitions.label)),
  );
});
