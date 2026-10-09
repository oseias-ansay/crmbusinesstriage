/** GET ?cnpj= — dados públicos da empresa (BrasilAPI) para preencher a ficha. */
import { ApiError, route } from "@/lib/api";
import { lookupCnpj } from "@/lib/services/clients";

export const GET = route(async (req) => {
  const cnpj = new URL(req.url).searchParams.get("cnpj") ?? "";
  const d = await lookupCnpj(cnpj).catch(() => null);
  if (!d) throw new ApiError(404, "CNPJ não encontrado na Receita (confira os números)");
  return d;
});
