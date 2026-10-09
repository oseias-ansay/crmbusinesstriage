/**
 * Clientes (quem contratou) e geração de contratos.
 */
import { and, count, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { clients, contacts, contractTemplates, contracts, deals, organizations, tenants } from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { MODELO_PADRAO } from "@/lib/contracts/render";

/**
 * Cria a ficha do cliente a partir do negócio ganho (idempotente: 1 por negócio).
 * Pré-preenche com o que o CRM já sabe — empresa, CNPJ e setor vindos do
 * diagnóstico, e-mail/telefone do contato, valor e recorrência do negócio.
 */
export async function ensureClientFromDeal(tx: Tx, tenantId: string, dealId: string) {
  const [exists] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.dealId, dealId)).limit(1);
  if (exists) return exists.id;
  const [row] = await tx
    .select({ deal: deals, contact: contacts, org: organizations })
    .from(deals)
    .leftJoin(contacts, eq(contacts.id, deals.contactId))
    .leftJoin(organizations, eq(organizations.id, deals.organizationId))
    .where(eq(deals.id, dealId))
    .limit(1);
  if (!row) return null;
  const cf = { ...(row.contact?.customFields ?? {}), ...(row.deal.customFields ?? {}) } as Record<string, unknown>;
  const str = (v: unknown) => (v == null || v === "" ? undefined : String(v));
  const razao = str(cf.empresa) ?? row.org?.name ?? row.contact?.name ?? row.deal.title;

  const [c] = await tx
    .insert(clients)
    .values({
      tenantId,
      dealId,
      contactId: row.contact?.id ?? null,
      razaoSocial: razao,
      cnpj: str(cf.cnpj)?.replace(/\D/g, "") ?? null,
      emailFinanceiro: row.contact?.email ?? null,
      telefone: row.contact?.phone ?? null,
      servico: row.deal.title,
      valor: row.deal.value,
      recorrente: row.deal.recurring,
      responsavelId: row.deal.userId,
      representante: { nome: row.contact && !/^\d+$/.test(row.contact.name) ? row.contact.name : undefined, email: row.contact?.email ?? undefined, telefone: row.contact?.phone ?? undefined },
      extras: { setor: str(cf.setor) },
    })
    .onConflictDoNothing()
    .returning({ id: clients.id });
  if (c) await logActivity(tx, { tenantId, type: "DEAL_WON", summary: "Ficha de cliente criada — complete os dados do contrato", dealId, contactId: row.contact?.id ?? null });
  return c?.id ?? null;
}

/** Garante que o tenant tenha ao menos um modelo de contrato. */
export async function ensureDefaultTemplate(tx: Tx, tenantId: string) {
  const [{ n }] = await tx.select({ n: count() }).from(contractTemplates).where(eq(contractTemplates.tenantId, tenantId));
  if (n > 0) return;
  await tx.insert(contractTemplates).values({ tenantId, name: "Prestação de serviços de consultoria (modelo)", body: MODELO_PADRAO, isDefault: true });
}

/** Próximo número de contrato do tenant: AAAA-0001. */
export async function nextContractNumber(tx: Tx, tenantId: string) {
  const year = new Date().getFullYear();
  const [{ n }] = await tx
    .select({ n: count() })
    .from(contracts)
    .where(and(eq(contracts.tenantId, tenantId), sql`extract(year from ${contracts.createdAt}) = ${year}`));
  return `${year}-${String(n + 1).padStart(4, "0")}`;
}

export async function tenantInfo(tx: Tx, tenantId: string) {
  const [t] = await tx.select({ name: tenants.name, settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return t;
}

/** Consulta pública de CNPJ (BrasilAPI) para pré-preencher a ficha. */
export async function lookupCnpj(cnpj: string) {
  const d = cnpj.replace(/\D/g, "");
  if (d.length !== 14) return null;
  const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${d}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const j = (await res.json()) as Record<string, string | number | null>;
  const s = (k: string) => (j[k] == null ? undefined : String(j[k]));
  return {
    razaoSocial: s("razao_social"),
    nomeFantasia: s("nome_fantasia") || undefined,
    endereco: {
      cep: s("cep"),
      logradouro: [s("descricao_tipo_de_logradouro"), s("logradouro")].filter(Boolean).join(" "),
      numero: s("numero"),
      complemento: s("complemento") || undefined,
      bairro: s("bairro"),
      cidade: s("municipio"),
      uf: s("uf"),
    },
    telefone: s("ddd_telefone_1")?.replace(/\D/g, ""),
    email: s("email") || undefined,
  };
}
