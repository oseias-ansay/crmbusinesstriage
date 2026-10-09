/** GET ficha completa · PATCH atualiza · DELETE remove (ADMIN). */
import { desc, eq } from "drizzle-orm";
import { withTenant } from "@/db";
import { clients, contacts, contracts, deals } from "@/db/schema";
import { notFound, parseBody, route } from "@/lib/api";
import { clientSchema } from "@/lib/client-schema";

type P = { id: string };

export const GET = route<P>(async (_req, { auth, params }) =>
  withTenant(auth.tenantId, async (tx) => {
    const [c] = await tx.select().from(clients).where(eq(clients.id, params.id)).limit(1);
    if (!c) notFound("Cliente");
    const [contact] = c.contactId ? await tx.select({ id: contacts.id, name: contacts.name, phone: contacts.phone, email: contacts.email }).from(contacts).where(eq(contacts.id, c.contactId)) : [];
    const [deal] = c.dealId ? await tx.select({ id: deals.id, title: deals.title, closedAt: deals.closedAt }).from(deals).where(eq(deals.id, c.dealId)) : [];
    const list = await tx
      .select({ id: contracts.id, number: contracts.number, title: contracts.title, status: contracts.status, createdAt: contracts.createdAt, signedAt: contracts.signedAt })
      .from(contracts)
      .where(eq(contracts.clientId, c.id))
      .orderBy(desc(contracts.createdAt));
    return { ...c, contact: contact ?? null, deal: deal ?? null, contracts: list };
  }),
);

export const PATCH = route<P>(async (req, { auth, params }) => {
  const body = await parseBody(req, clientSchema.partial());
  return withTenant(auth.tenantId, async (tx) => {
    const [cur] = await tx.select().from(clients).where(eq(clients.id, params.id)).limit(1);
    if (!cur) notFound("Cliente");
    const [c] = await tx
      .update(clients)
      .set({
        ...body,
        ...(body.valor != null && { valor: String(body.valor) }),
        ...(body.endereco && { endereco: { ...cur.endereco, ...body.endereco } }),
        ...(body.representante && { representante: { ...cur.representante, ...body.representante } }),
      } as never)
      .where(eq(clients.id, params.id))
      .returning();
    return c;
  });
}, { minRole: "AGENT" });

export const DELETE = route<P>(async (_req, { auth, params }) => {
  await withTenant(auth.tenantId, (tx) => tx.delete(clients).where(eq(clients.id, params.id)));
  return { ok: true };
}, { minRole: "ADMIN" });
