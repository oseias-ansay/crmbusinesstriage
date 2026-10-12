/** POST (multipart: file, category?) → extrai o texto do PDF/Word/TXT e cria o documento. */
import { withTenant } from "@/db";
import { knowledgeDocs } from "@/db/schema";
import { ApiError, route } from "@/lib/api";
import { CATEGORIES, extractText } from "@/lib/copilot/knowledge";

const MAX = 15 * 1024 * 1024;

export const POST = route(async (req, { auth }) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "Arquivo ausente");
  if (file.size > MAX) throw new ApiError(413, "Arquivo maior que 15 MB");
  const cat = String(form.get("category") ?? "geral");
  let content: string;
  try {
    content = await extractText(file);
  } catch (e) {
    throw new ApiError(415, e instanceof Error ? e.message : "Não foi possível ler o arquivo");
  }
  if (content.length < 20) throw new ApiError(422, "Não encontrei texto no arquivo. Se for um PDF escaneado (imagem), cole o texto manualmente.");
  const title = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 160);
  return withTenant(auth.tenantId, async (tx) => {
    const [d] = await tx
      .insert(knowledgeDocs)
      .values({ tenantId: auth.tenantId, title, category: cat in CATEGORIES ? cat : "geral", content: content.slice(0, 300_000), sourceFile: file.name })
      .returning();
    return d;
  });
}, { minRole: "MANAGER" });
