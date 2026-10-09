/** GET contrato (texto) · PATCH { status, body? } — body só pode mudar enquanto rascunho. */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db";
import { contracts } from "@/db/schema";
import { ApiError, notFound, parseBody, route } from "@/lib/api";

type P = { id: string };

export const GET = route<P>(async (_req, { auth, params }) =>
  withTenant(auth.tenantId, async (tx) => {
    const [k] = await tx.select().from(contracts).where(eq(contracts.id, params.id)).limit(1);
    return k ?? notFound("Contrato");
  }),
);

const schema = z.object({ status: z.enum(["DRAFT", "SENT", "SIGNED", "CANCELED"]).optional(), body: z.string().min(20).max(100_000).optional() });

export const PATCH = route<P>(async (req, { auth, params }) => {
  const body = await parseBody(req, schema);
  return withTenant(auth.tenantId, async (tx) => {
    const [k] = await tx.select().from(contracts).where(eq(contracts.id, params.id)).limit(1);
    if (!k) notFound("Contrato");
    if (body.body && k.status !== "DRAFT") throw new ApiError(409, "Só é possível editar o texto de contratos em rascunho");
    const [u] = await tx
      .update(contracts)
      .set({ ...body, ...(body.status === "SIGNED" && !k.signedAt && { signedAt: new Date() }) })
      .where(eq(contracts.id, params.id))
      .returning();
    return u;
  });
}, { minRole: "AGENT" });
