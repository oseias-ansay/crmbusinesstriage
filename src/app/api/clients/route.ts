/** GET ?status=&q= lista de clientes · POST cria cliente manualmente. */
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { withTenant } from "@/db";
import { clients, contracts, users } from "@/db/schema";
import { parseBody, route } from "@/lib/api";
import { clientSchema } from "@/lib/client-schema";

export const GET = route(async (req, { auth }) => {
  const u = new URL(req.url);
  const status = u.searchParams.get("status");
  const q = u.searchParams.get("q")?.trim();
  return withTenant(auth.tenantId, (tx) =>
    tx
      .select({
        id: clients.id, razaoSocial: clients.razaoSocial, nomeFantasia: clients.nomeFantasia, cnpj: clients.cnpj, status: clients.status,
        valor: clients.valor, recorrente: clients.recorrente, inicioEm: clients.inicioEm, createdAt: clients.createdAt,
        responsavel: users.name,
        contratos: sql<number>`(select count(*)::int from ${contracts} where ${contracts.clientId} = ${clients.id})`,
        pendencias: sql<number>`(case when ${clients.cnpj} is null then 1 else 0 end
          + case when coalesce(${clients.representante}->>'nome','') = '' then 1 else 0 end
          + case when coalesce(${clients.representante}->>'cpf','') = '' then 1 else 0 end
          + case when coalesce(${clients.endereco}->>'cidade','') = '' then 1 else 0 end
          + case when ${clients.inicioEm} is null then 1 else 0 end)::int`,
      })
      .from(clients)
      .leftJoin(users, eq(users.id, clients.responsavelId))
      .where(
        and(
          status ? eq(clients.status, status) : undefined,
          q ? or(ilike(clients.razaoSocial, `%${q}%`), ilike(clients.nomeFantasia, `%${q}%`), ilike(clients.cnpj, `%${q.replace(/\D/g, "") || q}%`)) : undefined,
        ),
      )
      .orderBy(desc(clients.createdAt))
      .limit(500),
  );
});

export const POST = route(async (req, { auth }) => {
  const body = await parseBody(req, clientSchema);
  return withTenant(auth.tenantId, async (tx) => {
    const [c] = await tx
      .insert(clients)
      .values({ ...body, tenantId: auth.tenantId, valor: String(body.valor ?? 0), endereco: body.endereco ?? {}, representante: body.representante ?? {} } as never)
      .returning();
    return c;
  });
}, { minRole: "MANAGER" });
