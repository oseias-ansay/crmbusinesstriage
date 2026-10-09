/** GET — PDF do contrato (gerado na hora a partir do texto congelado). */
import { eq } from "drizzle-orm";
import { withTenant } from "@/db";
import { clients, contracts } from "@/db/schema";
import { notFound, route } from "@/lib/api";
import { renderPdf } from "@/lib/contracts/render";
import { tenantInfo } from "@/lib/services/clients";

export const GET = route<{ id: string }>(async (req, { auth, params }) => {
  const data = await withTenant(auth.tenantId, async (tx) => {
    const [row] = await tx.select({ k: contracts, c: clients }).from(contracts).innerJoin(clients, eq(clients.id, contracts.clientId)).where(eq(contracts.id, params.id)).limit(1);
    if (!row) notFound("Contrato");
    const t = await tenantInfo(tx, auth.tenantId);
    return { ...row, t };
  });
  const pdf = await renderPdf(
    data.k.title,
    data.k.body,
    { contratante: data.c.razaoSocial, contratada: data.t.settings.company?.razaoSocial || data.t.name },
    `Contrato nº ${data.k.number}`,
  );
  const inline = new URL(req.url).searchParams.get("download") !== "1";
  const file = `contrato-${data.k.number}-${data.c.razaoSocial.normalize("NFD").replace(/[^\w]+/g, "-").toLowerCase()}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${file}"`, "Cache-Control": "private, no-store" },
  });
});
