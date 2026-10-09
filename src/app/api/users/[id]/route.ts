/**
 * PATCH /api/users/:id { name?, role?, isActive?, receivesLeads?, password? }
 * Gestão da equipe (ADMIN+). Protege contra: tirar o próprio acesso, rebaixar/
 * desativar o último dono e promover a SUPER_ADMIN pela tela.
 */
import { and, count, eq, inArray, ne } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { withTenant } from "@/db";
import { tenants, users } from "@/db/schema";
import { ApiError, notFound, parseBody, route } from "@/lib/api";
import { hasRole } from "@/lib/auth";
import { passwordSchema } from "@/lib/password";

const schema = z.object({
  name: z.string().min(2).max(120).optional(),
  role: z.enum(["OWNER", "ADMIN", "MANAGER", "AGENT"]).optional(),
  isActive: z.boolean().optional(),
  receivesLeads: z.boolean().optional(),
  password: passwordSchema.optional(),
});

export const PATCH = route<{ id: string }>(async (req, { auth, params }) => {
  const body = await parseBody(req, schema);
  return withTenant(auth.tenantId, async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, params.id)).limit(1);
    if (!u) notFound("Usuário");
    const isSelf = u.id === auth.userId;
    if (isSelf && (body.isActive === false || (body.role && body.role !== u.role))) {
      throw new ApiError(400, "Você não pode desativar nem mudar o papel do seu próprio usuário");
    }
    if (u.role === "SUPER_ADMIN" && auth.role !== "SUPER_ADMIN") throw new ApiError(403, "Sem permissão para alterar este usuário");
    if (body.role === "OWNER" && !hasRole(auth.role, "OWNER")) throw new ApiError(403, "Só o dono pode promover a dono");
    // Não deixar a empresa sem nenhum dono/admin ativo
    const losingAdmin = ["OWNER", "ADMIN", "SUPER_ADMIN"].includes(u.role) && (body.isActive === false || (body.role && !["OWNER", "ADMIN"].includes(body.role)));
    if (losingAdmin) {
      const [{ n }] = await tx
        .select({ n: count() })
        .from(users)
        .where(and(ne(users.id, u.id), eq(users.isActive, true), inArray(users.role, ["OWNER", "ADMIN", "SUPER_ADMIN"])));
      if (n === 0) throw new ApiError(400, "A empresa precisa de pelo menos um administrador ativo");
    }
    // Reativar respeita o limite do plano
    if (body.isActive === true && !u.isActive) {
      const [t] = await tx.select({ max: tenants.maxUsers }).from(tenants).where(eq(tenants.id, auth.tenantId));
      const [{ n }] = await tx.select({ n: count() }).from(users).where(eq(users.isActive, true));
      if (n >= t.max) throw new ApiError(402, `Seu plano permite até ${t.max} usuários ativos`);
    }
    const { password, ...rest } = body;
    const [updated] = await tx
      .update(users)
      .set({ ...rest, ...(password && { passwordHash: await bcrypt.hash(password, 12) }) })
      .where(eq(users.id, u.id))
      .returning({ id: users.id, name: users.name, email: users.email, role: users.role, isActive: users.isActive, receivesLeads: users.receivesLeads });
    return updated;
  });
}, { minRole: "ADMIN" });
