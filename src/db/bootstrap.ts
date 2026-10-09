/**
 * Bootstrap de PRODUÇÃO (sem dados de exemplo):
 * cria o tenant padrão Business Triage com pipelines, motivos de perda,
 * respostas rápidas e automações-modelo, mais o usuário Super Admin.
 *
 *   ADMIN_NAME="Oseias" ADMIN_EMAIL="voce@dominio" ADMIN_PASSWORD="..." npm run db:bootstrap
 *
 * Idempotente: se o tenant já existir, não faz nada.
 */
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { withAdmin } from "./index";
import * as s from "./schema";
import { createTenant, seedTenantData } from "./seed";

async function main() {
  const slug = process.env.DEFAULT_TENANT_SLUG ?? "business-triage";
  const email = process.env.ADMIN_EMAIL?.toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 10) {
    throw new Error("Defina ADMIN_EMAIL e ADMIN_PASSWORD (mínimo 10 caracteres)");
  }

  const created = await withAdmin(async (tx) => {
    const [exists] = await tx.select({ id: s.tenants.id }).from(s.tenants).where(eq(s.tenants.slug, slug)).limit(1);
    if (exists) return false;
    const tenant = await createTenant(tx, { name: "Business Triage", slug, primary: "#0F2A44", secondary: "#14B8A6", plan: "ENTERPRISE" });
    const users = await tx
      .insert(s.users)
      .values({ tenantId: tenant.id, name: process.env.ADMIN_NAME ?? "Administrador", email, passwordHash: await bcrypt.hash(password, 12), role: "SUPER_ADMIN" })
      .returning();
    await seedTenantData(tx, tenant.id, users, false);
    return true;
  });

  console.log(created ? `✔ Tenant "${slug}" e Super Admin ${email} criados` : `• Tenant "${slug}" já existe — nada a fazer`);
  process.exit(0);
}

main().catch((e) => {
  console.error("✖", e.message ?? e);
  process.exit(1);
});
