/**
 * Contratos: variáveis, modelo padrão e geração do PDF.
 *
 * Sintaxe do modelo (texto simples, fácil de editar na tela):
 *   # Título              → título centralizado
 *   ## Cláusula 1 – ...   → subtítulo em negrito
 *   - item                → lista
 *   **negrito**           → negrito dentro do parágrafo
 *   {{variavel}}          → substituída pelos dados do cliente
 *   [[assinaturas]]       → bloco de assinaturas (contratante, contratada, testemunhas)
 *   [[quebra]]            → nova página
 */
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { Client, TenantSettings } from "@/db/schema";
import { valorPorExtenso } from "./extenso";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const fmtDoc = (d?: string | null) => {
  const s = (d ?? "").replace(/\D/g, "");
  if (s.length === 14) return s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (s.length === 11) return s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return d ?? "";
};
const fmtCep = (c?: string) => (c ?? "").replace(/\D/g, "").replace(/^(\d{5})(\d{3})$/, "$1-$2");

export function enderecoCompleto(e: Client["endereco"]) {
  const l1 = [e.logradouro, e.numero].filter(Boolean).join(", ");
  return [l1 + (e.complemento ? ` – ${e.complemento}` : ""), e.bairro, [e.cidade, e.uf].filter(Boolean).join("/"), e.cep ? `CEP ${fmtCep(e.cep)}` : ""]
    .filter((x) => x && x.trim())
    .join(", ");
}

/** Monta o objeto de variáveis que o modelo pode usar. */
export function contractVars(c: Client, company: TenantSettings["company"], numero: string, tenantName: string) {
  const valor = Number(c.valor);
  const rep = c.representante ?? {};
  const hoje = new Date();
  return {
    cliente: {
      razaoSocial: c.razaoSocial,
      nomeFantasia: c.nomeFantasia ?? "",
      cnpj: fmtDoc(c.cnpj),
      inscricaoEstadual: c.inscricaoEstadual ?? "isento",
      endereco: enderecoCompleto(c.endereco ?? {}),
      cidade: c.endereco?.cidade ?? "",
      uf: c.endereco?.uf ?? "",
      email: c.emailFinanceiro ?? rep.email ?? "",
      telefone: c.telefone ?? rep.telefone ?? "",
      representante: { ...rep, cpf: fmtDoc(rep.cpf) },
    },
    contrato: {
      numero,
      servico: c.servico ?? "",
      valor: brl(valor),
      valorExtenso: valorPorExtenso(valor),
      periodicidade: c.recorrente ? "mensais" : "",
      formaPagamento: c.formaPagamento ?? "",
      diaVencimento: c.diaVencimento ?? "",
      inicio: c.inicioEm ? format(c.inicioEm, "dd/MM/yyyy") : "",
      vigenciaMeses: c.vigenciaMeses ?? "",
      indiceReajuste: c.indiceReajuste ?? "IPCA",
      data: format(hoje, "d 'de' MMMM 'de' yyyy", { locale: ptBR }),
      observacoes: c.observacoes ?? "",
    },
    contratada: {
      razaoSocial: company?.razaoSocial || tenantName,
      cnpj: fmtDoc(company?.cnpj),
      endereco: company?.endereco ?? "",
      representante: company?.representante ?? "",
      cpfRepresentante: fmtDoc(company?.cpfRepresentante),
      cidadeForo: company?.cidadeForo ?? "",
    },
  };
}

/** Lista as variáveis disponíveis (para a ajuda do editor). */
export const VARIAVEIS = [
  "cliente.razaoSocial", "cliente.nomeFantasia", "cliente.cnpj", "cliente.inscricaoEstadual", "cliente.endereco", "cliente.cidade", "cliente.uf",
  "cliente.email", "cliente.telefone", "cliente.representante.nome", "cliente.representante.cpf", "cliente.representante.rg",
  "cliente.representante.cargo", "cliente.representante.estadoCivil", "cliente.representante.nacionalidade", "cliente.representante.profissao",
  "contrato.numero", "contrato.servico", "contrato.valor", "contrato.valorExtenso", "contrato.periodicidade", "contrato.formaPagamento",
  "contrato.diaVencimento", "contrato.inicio", "contrato.vigenciaMeses", "contrato.indiceReajuste", "contrato.data", "contrato.observacoes",
  "contratada.razaoSocial", "contratada.cnpj", "contratada.endereco", "contratada.representante", "contratada.cpfRepresentante", "contratada.cidadeForo",
];

/** Substitui {{a.b.c}}; variável vazia vira "________" para ficar visível no PDF. */
export function fillTemplate(tpl: string, vars: Record<string, unknown>) {
  const missing = new Set<string>();
  const out = tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const v = path.split(".").reduce<unknown>((acc, k) => (acc as Record<string, unknown> | undefined)?.[k], vars);
    if (v == null || v === "") {
      missing.add(path);
      return "________";
    }
    return String(v);
  });
  return { text: out, missing: [...missing] };
}

// ───────────────────────── PDF (pdfmake, sem navegador) ─────────────────────────

type Inline = string | { text: string; bold?: boolean };
function inline(s: string): Inline[] {
  return s.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((p) => (p.startsWith("**") ? { text: p.slice(2, -2), bold: true } : p));
}

/** Um bloco pode ter título + parágrafo + itens de lista misturados. */
function pushLines(content: unknown[], lines: string[]) {
  let para: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (para.length) content.push({ text: inline(para.join(" ")), style: "p" });
    if (list.length) content.push({ ul: list.map((l) => ({ text: inline(l) })), style: "p" });
    para = [];
    list = [];
  };
  for (const l of lines) {
    if (l.startsWith("# ")) { flush(); content.push({ text: l.slice(2), style: "titulo" }); continue; }
    if (l.startsWith("## ")) { flush(); content.push({ text: l.slice(3), style: "h2" }); continue; }
    const m = l.match(/^\s*[-•]\s+(.*)$/);
    if (m) { if (para.length) { content.push({ text: inline(para.join(" ")), style: "p" }); para = []; } list.push(m[1]); continue; }
    if (list.length) flush();
    para.push(l);
  }
  flush();
}

export function toPdfContent(body: string, assinaturas: { contratante: string; contratada: string }) {
  const content: unknown[] = [];
  const blocks = body.replace(/\r/g, "").split(/\n\s*\n/);
  for (const raw of blocks) {
    const b = raw.trim();
    if (!b) continue;
    if (b === "[[quebra]]") {
      content.push({ text: "", pageBreak: "after" });
      continue;
    }
    if (b === "[[assinaturas]]") {
      const linha = (nome: string, papel: string) => ({
        stack: [{ text: "_______________________________________", margin: [0, 40, 0, 2] }, { text: nome, bold: true }, { text: papel, fontSize: 9, color: "#555" }],
        alignment: "center",
      });
      content.push({ columns: [linha(assinaturas.contratante, "CONTRATANTE"), linha(assinaturas.contratada, "CONTRATADA")], columnGap: 30, unbreakable: true });
      content.push({
        columns: [linha("Testemunha 1 — Nome/CPF", ""), linha("Testemunha 2 — Nome/CPF", "")],
        columnGap: 30,
        margin: [0, 10, 0, 0],
        unbreakable: true,
      });
      continue;
    }
    pushLines(content, b.split("\n"));
  }
  return content;
}

export async function renderPdf(title: string, body: string, assinaturas: { contratante: string; contratada: string }, rodape: string): Promise<Buffer> {
  // carregado só no servidor (pdfmake fica fora do bundle do Next)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import("pdfmake");
  const PdfPrinter = mod.default ?? mod;
  const vfs = (await import("pdfmake/build/vfs_fonts.js")) as unknown as Record<string, string> & { default?: Record<string, string> };
  const fonts = vfs.default ?? vfs;
  const b = (f: string) => Buffer.from(fonts[f], "base64");
  const printer = new PdfPrinter({
    Roboto: { normal: b("Roboto-Regular.ttf"), bold: b("Roboto-Medium.ttf"), italics: b("Roboto-Italic.ttf"), bolditalics: b("Roboto-MediumItalic.ttf") },
  });
  const doc = printer.createPdfKitDocument({
    info: { title },
    pageSize: "A4",
    pageMargins: [60, 60, 60, 60],
    defaultStyle: { font: "Roboto", fontSize: 10, lineHeight: 1.3 },
    styles: {
      titulo: { fontSize: 13, bold: true, alignment: "center", margin: [0, 0, 0, 14] },
      h2: { fontSize: 10.5, bold: true, margin: [0, 10, 0, 4] },
      p: { alignment: "justify", margin: [0, 0, 0, 6] },
    },
    footer: (page: number, pages: number) => ({ text: `${rodape} — página ${page} de ${pages}`, alignment: "center", fontSize: 8, color: "#888", margin: [0, 20, 0, 0] }),
    content: toPdfContent(body, assinaturas) as never,
  } as never);
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

/** Modelo inicial — revise com seu advogado antes de usar. */
export const MODELO_PADRAO = `# CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE CONSULTORIA EMPRESARIAL Nº {{contrato.numero}}

Pelo presente instrumento particular, de um lado **{{cliente.razaoSocial}}**, inscrita no CNPJ sob o nº {{cliente.cnpj}}, com sede em {{cliente.endereco}}, neste ato representada por **{{cliente.representante.nome}}**, {{cliente.representante.nacionalidade}}, {{cliente.representante.estadoCivil}}, {{cliente.representante.profissao}}, inscrito(a) no CPF sob o nº {{cliente.representante.cpf}}, doravante denominada **CONTRATANTE**; e, de outro lado, **{{contratada.razaoSocial}}**, inscrita no CNPJ sob o nº {{contratada.cnpj}}, com sede em {{contratada.endereco}}, neste ato representada por **{{contratada.representante}}**, inscrito(a) no CPF sob o nº {{contratada.cpfRepresentante}}, doravante denominada **CONTRATADA**, têm entre si justo e contratado o seguinte:

## CLÁUSULA 1ª – DO OBJETO
A CONTRATADA prestará à CONTRATANTE os seguintes serviços: {{contrato.servico}}.

## CLÁUSULA 2ª – DO PRAZO
O presente contrato vigora pelo prazo de {{contrato.vigenciaMeses}} meses, a contar de {{contrato.inicio}}, podendo ser renovado mediante acordo entre as partes.

## CLÁUSULA 3ª – DO VALOR E DA FORMA DE PAGAMENTO
Pelos serviços, a CONTRATANTE pagará à CONTRATADA o valor de {{contrato.valor}} ({{contrato.valorExtenso}}) {{contrato.periodicidade}}, por meio de {{contrato.formaPagamento}}, com vencimento todo dia {{contrato.diaVencimento}}. O atraso no pagamento sujeita a CONTRATANTE a multa de 2% (dois por cento) e juros de 1% (um por cento) ao mês, calculados pro rata die.

## CLÁUSULA 4ª – DO REAJUSTE
O valor será reajustado a cada 12 (doze) meses pela variação acumulada do {{contrato.indiceReajuste}} ou, na falta deste, por outro índice oficial que o substitua.

## CLÁUSULA 5ª – DAS OBRIGAÇÕES DA CONTRATADA
- Executar os serviços com zelo, técnica e dentro dos prazos combinados;
- Manter a CONTRATANTE informada sobre o andamento dos trabalhos;
- Guardar sigilo sobre todas as informações a que tiver acesso.

## CLÁUSULA 6ª – DAS OBRIGAÇÕES DA CONTRATANTE
- Fornecer, em tempo hábil, as informações e os documentos necessários à execução dos serviços;
- Efetuar os pagamentos nas datas acordadas;
- Indicar um responsável para acompanhar os trabalhos.

## CLÁUSULA 7ª – DA CONFIDENCIALIDADE E DA PROTEÇÃO DE DADOS
As partes se obrigam a manter sigilo sobre as informações trocadas em razão deste contrato e a tratar os dados pessoais envolvidos em conformidade com a Lei nº 13.709/2018 (Lei Geral de Proteção de Dados), utilizando-os exclusivamente para a execução deste contrato.

## CLÁUSULA 8ª – DA RESCISÃO
Este contrato poderá ser rescindido por qualquer das partes, mediante aviso prévio por escrito de 30 (trinta) dias, sendo devidos os valores dos serviços prestados até a data da rescisão. O descumprimento de qualquer cláusula autoriza a rescisão imediata pela parte prejudicada.

## CLÁUSULA 9ª – DO FORO
Fica eleito o foro da comarca de {{contratada.cidadeForo}} para dirimir quaisquer dúvidas oriundas deste contrato, com renúncia a qualquer outro, por mais privilegiado que seja.

E, por estarem assim justas e contratadas, as partes assinam o presente instrumento em 2 (duas) vias de igual teor, na presença de 2 (duas) testemunhas.

{{contratada.cidadeForo}}, {{contrato.data}}.

[[assinaturas]]`;
