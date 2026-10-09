/**
 * Painel Admin Global (somente SUPER_ADMIN).
 * GET: lista tenants com uso · POST: provisiona novo tenant (white-label)
 * já com pipeline padrão, etapas, motivos de perda e usuário dono.
 */
import { desc, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { withAdmin } from "@/db";
import { lossReasons, pipelines, stages, tenants, users } from "@/db/schema";
import { ApiError, parseBody, route } from "@/lib/api";
import { tenantAdminSchema } from "@/lib/validators";

export const GET = route(async () =>
  withAdmin((tx) =>
    tx
      .select({
        tenant: tenants,
        usersCount: sql<number>`(select count(*)::int from users u where u.tenant_id = ${tenants.id})`,
        contactsCount: sql<number>`(select count(*)::int from contacts c where c.tenant_id = ${tenants.id})`,
        dealsCount: sql<number>`(select count(*)::int from deals d where d.tenant_id = ${tenants.id})`,
      })
      .from(tenants)
      .orderBy(desc(tenants.createdAt)),
  ),
  { minRole: "SUPER_ADMIN" },
);

const DEFAULT_STAGES: [string, string, number, boolean?, boolean?][] = [
  ["Novo lead", "#94A3B8", 10],
  ["Qualificação", "#38BDF8", 25],
  ["Proposta", "#F59E0B", 60],
  ["Negociação", "#F97316", 80],
  ["Ganho", "#10B981", 100, true],
  ["Perdido", "#EF4444", 0, false, true],
];

export const POST = route(async (req) => {
  const body = await parseBody(req, tenantAdminSchema);
  return withAdmin(async (tx) => {
    const { owner, ...data } = body;
    const exists = await tx.execute(sql`select 1 from tenants where slug = ${data.slug} or (domain is not null and domain = ${data.domain ?? ""})`);
    if (exists.rows.length) throw new ApiError(409, "Slug ou domínio já em uso");

    const [t] = await tx.insert(tenants).values({ ...data, domain: data.domain || null, trialEndsAt: new Date(Date.now() + 14 * 86_400_000) }).returning();
    const [p] = await tx.insert(pipelines).values({ tenantId: t.id, name: "Vendas", isDefault: true }).returning();
    await tx.insert(stages).values(
      DEFAULT_STAGES.map(([name, color, probability, isWon, isLost], order) => ({ tenantId: t.id, pipelineId: p.id, name, color, probability, order, isWon: !!isWon, isLost: !!isLost })),
    );
    await tx.insert(lossReasons).values(["Preço", "Sem timing", "Concorrente", "Sem resposta"].map((name) => ({ tenantId: t.id, name })));
    if (owner) {
      await tx.insert(users).values({ tenantId: t.id, name: owner.name, email: owner.email.toLowerCase(), role: "OWNER", passwordHash: await bcrypt.hash(owner.password, 10) });
    }
    return Response.json(t, { status: 201 });
  });
}, { minRole: "SUPER_ADMIN" });
