"use client";
/** Ficha do cliente: dados do contrato + geração e acompanhamento dos contratos. */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, Download, Eye, FilePlus2, Pencil, Search, Settings2 } from "lucide-react";
import { api } from "@/lib/fetcher";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { CONTRACT_STATUS, STATUS, fmtDocument } from "./status";
import { TemplatesDialog } from "./templates-dialog";

type Addr = { cep?: string; logradouro?: string; numero?: string; complemento?: string; bairro?: string; cidade?: string; uf?: string };
type Rep = { nome?: string; cpf?: string; rg?: string; cargo?: string; estadoCivil?: string; nacionalidade?: string; profissao?: string; email?: string; telefone?: string };
type Client = {
  id: string; status: string; razaoSocial: string; nomeFantasia: string | null; cnpj: string | null; inscricaoEstadual: string | null;
  endereco: Addr; representante: Rep; emailFinanceiro: string | null; telefone: string | null; servico: string | null; valor: string; recorrente: boolean;
  formaPagamento: string | null; diaVencimento: number | null; inicioEm: string | null; vigenciaMeses: number | null; indiceReajuste: string | null; observacoes: string | null;
  contact: { id: string; name: string } | null; deal: { id: string; title: string } | null;
  contracts: { id: string; number: string; title: string; status: string; createdAt: string; signedAt: string | null }[];
};
type Tpl = { id: string; name: string; body: string; isDefault: boolean };

const ESTADOS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");

export function ClientFicha({ id }: { id: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["client", id], queryFn: () => api<Client>(`/api/clients/${id}`) });
  const { data: tpls } = useQuery({ queryKey: ["contract-templates"], queryFn: () => api<{ templates: Tpl[]; variaveis: string[] }>("/api/contract-templates") });
  const [f, setF] = useState<Client | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [tplId, setTplId] = useState("");
  const [tplOpen, setTplOpen] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  useEffect(() => { if (data) setF(data); }, [data]);
  useEffect(() => { if (tpls && !tplId) setTplId((tpls.templates.find((t) => t.isDefault) ?? tpls.templates[0])?.id ?? ""); }, [tpls, tplId]);

  const save = useMutation({
    mutationFn: (b: Partial<Client>) => api<Client>(`/api/clients/${id}`, { method: "PATCH", json: b }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["client", id] }); setMsg({ ok: true, text: "Ficha salva." }); },
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  });
  const cnpj = useMutation({
    mutationFn: (doc: string) => api<{ razaoSocial?: string; nomeFantasia?: string; endereco: Addr; telefone?: string; email?: string }>(`/api/clients/cnpj?cnpj=${doc}`),
    onSuccess: (d) => {
      if (!f) return;
      setF({ ...f, razaoSocial: d.razaoSocial ?? f.razaoSocial, nomeFantasia: d.nomeFantasia ?? f.nomeFantasia, endereco: { ...f.endereco, ...d.endereco }, telefone: f.telefone || d.telefone || null, emailFinanceiro: f.emailFinanceiro || d.email || null });
      setMsg({ ok: true, text: "Dados da Receita preenchidos. Confira e clique em Salvar." });
    },
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  });
  const gen = useMutation({
    mutationFn: async () => {
      if (f && JSON.stringify(f) !== JSON.stringify(data)) await save.mutateAsync(payload(f));
      return api<{ id: string; number: string; missing: string[] }>(`/api/clients/${id}/contracts`, { method: "POST", json: { templateId: tplId } });
    },
    onSuccess: (k) => {
      qc.invalidateQueries({ queryKey: ["client", id] });
      setMsg(k.missing.length
        ? { ok: false, text: `Contrato ${k.number} gerado, mas faltam dados (aparecem como ________): ${k.missing.join(", ")}. Complete a ficha e gere de novo, ou edite o texto do rascunho.` }
        : { ok: true, text: `Contrato ${k.number} gerado.` });
      setViewing(k.id);
    },
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  });
  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: string }) => api(`/api/contracts/${v.id}`, { method: "PATCH", json: { status: v.status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["client", id] }),
  });

  if (!f) return <p className="p-6 text-sm text-slate-500">Carregando…</p>;
  const set = (p: Partial<Client>) => setF({ ...f, ...p });
  const setE = (p: Partial<Addr>) => setF({ ...f, endereco: { ...f.endereco, ...p } });
  const setR = (p: Partial<Rep>) => setF({ ...f, representante: { ...f.representante, ...p } });
  const dirty = JSON.stringify(f) !== JSON.stringify(data);
  const field = (label: string, el: React.ReactNode, cls = "") => <div className={cls}><Label>{label}</Label>{el}</div>;

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/clients" className="rounded p-1 hover:bg-slate-100" aria-label="Voltar"><ArrowLeft size={18} /></Link>
        <h1 className="text-xl font-semibold">{f.razaoSocial}</h1>
        <Select value={f.status} onChange={(e) => set({ status: e.target.value })} className="h-8 text-xs">
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        <div className="ml-auto flex gap-2 text-sm">
          {f.deal && <Link className="text-secondary underline" href={`/pipeline?deal=${f.deal.id}`}>Ver negócio</Link>}
          {f.contact && <Link className="text-secondary underline" href={`/contacts/${f.contact.id}`}>Ver contato</Link>}
          <Button onClick={() => save.mutate(payload(f))} disabled={!dirty || save.isPending}>Salvar ficha</Button>
        </div>
      </div>
      {msg && <p className={`rounded-lg p-3 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>{msg.text}</p>}

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card className="grid gap-3 p-4 md:grid-cols-6">
            <h2 className="font-semibold md:col-span-6">Empresa contratante</h2>
            {field("CNPJ ou CPF", (
              <div className="flex gap-1">
                <Input value={fmtDocument(f.cnpj)} onChange={(e) => set({ cnpj: e.target.value.replace(/\D/g, "") })} />
                <Button type="button" variant="outline" size="icon" title="Buscar dados na Receita" disabled={(f.cnpj ?? "").length !== 14 || cnpj.isPending} onClick={() => cnpj.mutate(f.cnpj!)}><Search size={14} /></Button>
              </div>
            ), "md:col-span-2")}
            {field("Razão social", <Input value={f.razaoSocial} onChange={(e) => set({ razaoSocial: e.target.value })} />, "md:col-span-4")}
            {field("Nome fantasia", <Input value={f.nomeFantasia ?? ""} onChange={(e) => set({ nomeFantasia: e.target.value })} />, "md:col-span-2")}
            {field("Inscrição estadual", <Input value={f.inscricaoEstadual ?? ""} onChange={(e) => set({ inscricaoEstadual: e.target.value })} placeholder="isento" />, "md:col-span-2")}
            {field("Telefone", <Input value={f.telefone ?? ""} onChange={(e) => set({ telefone: e.target.value })} />, "md:col-span-2")}
            {field("E-mail financeiro (cobrança/NF)", <Input type="email" value={f.emailFinanceiro ?? ""} onChange={(e) => set({ emailFinanceiro: e.target.value })} />, "md:col-span-3")}
            {field("CEP", <Input value={f.endereco.cep ?? ""} onChange={(e) => setE({ cep: e.target.value })} />, "md:col-span-1")}
            {field("Logradouro", <Input value={f.endereco.logradouro ?? ""} onChange={(e) => setE({ logradouro: e.target.value })} />, "md:col-span-2")}
            {field("Número", <Input value={f.endereco.numero ?? ""} onChange={(e) => setE({ numero: e.target.value })} />, "md:col-span-1")}
            {field("Complemento", <Input value={f.endereco.complemento ?? ""} onChange={(e) => setE({ complemento: e.target.value })} />, "md:col-span-2")}
            {field("Bairro", <Input value={f.endereco.bairro ?? ""} onChange={(e) => setE({ bairro: e.target.value })} />, "md:col-span-2")}
            {field("Cidade", <Input value={f.endereco.cidade ?? ""} onChange={(e) => setE({ cidade: e.target.value })} />, "md:col-span-3")}
            {field("UF", <Select className="w-full" value={f.endereco.uf ?? ""} onChange={(e) => setE({ uf: e.target.value })}><option value="">—</option>{ESTADOS.map((u) => <option key={u}>{u}</option>)}</Select>, "md:col-span-1")}
          </Card>

          <Card className="grid gap-3 p-4 md:grid-cols-6">
            <h2 className="font-semibold md:col-span-6">Representante legal (quem assina)</h2>
            {field("Nome completo", <Input value={f.representante.nome ?? ""} onChange={(e) => setR({ nome: e.target.value })} />, "md:col-span-3")}
            {field("CPF", <Input value={fmtDocument(f.representante.cpf)} onChange={(e) => setR({ cpf: e.target.value.replace(/\D/g, "") })} />, "md:col-span-2")}
            {field("RG", <Input value={f.representante.rg ?? ""} onChange={(e) => setR({ rg: e.target.value })} />, "md:col-span-1")}
            {field("Cargo", <Input value={f.representante.cargo ?? ""} onChange={(e) => setR({ cargo: e.target.value })} placeholder="Sócio-administrador" />, "md:col-span-2")}
            {field("Estado civil", <Select className="w-full" value={f.representante.estadoCivil ?? ""} onChange={(e) => setR({ estadoCivil: e.target.value })}><option value="">—</option>{["solteiro(a)", "casado(a)", "divorciado(a)", "viúvo(a)", "em união estável"].map((x) => <option key={x}>{x}</option>)}</Select>, "md:col-span-2")}
            {field("Nacionalidade", <Input value={f.representante.nacionalidade ?? ""} onChange={(e) => setR({ nacionalidade: e.target.value })} placeholder="brasileiro(a)" />, "md:col-span-2")}
            {field("Profissão", <Input value={f.representante.profissao ?? ""} onChange={(e) => setR({ profissao: e.target.value })} placeholder="empresário(a)" />, "md:col-span-2")}
            {field("E-mail", <Input value={f.representante.email ?? ""} onChange={(e) => setR({ email: e.target.value })} />, "md:col-span-2")}
            {field("Telefone", <Input value={f.representante.telefone ?? ""} onChange={(e) => setR({ telefone: e.target.value })} />, "md:col-span-2")}
          </Card>

          <Card className="grid gap-3 p-4 md:grid-cols-6">
            <h2 className="font-semibold md:col-span-6">Condições do contrato</h2>
            {field("Objeto / serviços contratados", <Textarea rows={3} value={f.servico ?? ""} onChange={(e) => set({ servico: e.target.value })} />, "md:col-span-6")}
            {field("Valor (R$)", <Input type="number" step="0.01" value={f.valor} onChange={(e) => set({ valor: e.target.value })} />, "md:col-span-2")}
            <label className="flex items-end gap-2 pb-2 text-sm md:col-span-2"><input type="checkbox" checked={f.recorrente} onChange={(e) => set({ recorrente: e.target.checked })} /> Valor mensal (recorrente)</label>
            {field("Forma de pagamento", <Select className="w-full" value={f.formaPagamento ?? ""} onChange={(e) => set({ formaPagamento: e.target.value })}><option value="">—</option>{["PIX", "boleto bancário", "transferência bancária", "cartão de crédito"].map((x) => <option key={x}>{x}</option>)}</Select>, "md:col-span-2")}
            {field("Dia do vencimento", <Input type="number" min={1} max={31} value={f.diaVencimento ?? ""} onChange={(e) => set({ diaVencimento: e.target.value ? Number(e.target.value) : null })} />, "md:col-span-2")}
            {field("Início", <Input type="date" value={f.inicioEm ? f.inicioEm.slice(0, 10) : ""} onChange={(e) => set({ inicioEm: e.target.value || null })} />, "md:col-span-2")}
            {field("Vigência (meses)", <Input type="number" min={1} value={f.vigenciaMeses ?? ""} onChange={(e) => set({ vigenciaMeses: e.target.value ? Number(e.target.value) : null })} />, "md:col-span-1")}
            {field("Reajuste", <Select className="w-full" value={f.indiceReajuste ?? ""} onChange={(e) => set({ indiceReajuste: e.target.value })}><option value="">IPCA</option>{["IPCA", "IGP-M", "INPC"].map((x) => <option key={x}>{x}</option>)}</Select>, "md:col-span-1")}
            {field("Observações internas", <Textarea rows={2} value={f.observacoes ?? ""} onChange={(e) => set({ observacoes: e.target.value })} />, "md:col-span-6")}
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="space-y-3 p-4">
            <div className="flex items-center"><h2 className="mr-auto font-semibold">Contratos</h2>
              <Button size="sm" variant="ghost" onClick={() => setTplOpen(true)}><Settings2 size={14} /> Modelos</Button></div>
            <div className="flex gap-2">
              <Select className="min-w-0 flex-1" value={tplId} onChange={(e) => setTplId(e.target.value)}>
                {tpls?.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
              <Button onClick={() => gen.mutate()} disabled={!tplId || gen.isPending}><FilePlus2 size={14} /> Gerar</Button>
            </div>
            <ul className="divide-y text-sm">
              {f.contracts.map((k) => (
                <li key={k.id} className="space-y-1 py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Nº {k.number}</span>
                    <span className="text-xs text-slate-400">{format(new Date(k.createdAt), "dd/MM/yyyy")}</span>
                    <Select className="ml-auto h-7 text-xs" value={k.status} onChange={(e) => setStatus.mutate({ id: k.id, status: e.target.value })}>
                      {Object.entries(CONTRACT_STATUS).map(([s, v]) => <option key={s} value={s}>{v.label}</option>)}
                    </Select>
                  </div>
                  <div className="flex gap-1">
                    <Badge color={CONTRACT_STATUS[k.status]?.color}>{CONTRACT_STATUS[k.status]?.label}</Badge>
                    <button className="ml-auto flex items-center gap-1 text-xs text-secondary hover:underline" onClick={() => setViewing(k.id)}>{k.status === "DRAFT" ? <><Pencil size={12} /> Revisar</> : <><Eye size={12} /> Ver</>}</button>
                    <a className="flex items-center gap-1 text-xs text-secondary hover:underline" href={`/api/contracts/${k.id}/pdf`} target="_blank" rel="noreferrer"><Eye size={12} /> PDF</a>
                    <a className="flex items-center gap-1 text-xs text-secondary hover:underline" href={`/api/contracts/${k.id}/pdf?download=1`}><Download size={12} /> Baixar</a>
                  </div>
                </li>
              ))}
              {!f.contracts.length && <li className="py-3 text-slate-400">Nenhum contrato gerado. Preencha a ficha, escolha o modelo e clique em Gerar.</li>}
            </ul>
            <p className="text-xs text-slate-500">O texto do contrato fica congelado ao gerar. Mudou a ficha? Gere um novo e cancele o anterior.</p>
          </Card>
        </div>
      </div>

      {tpls && <TemplatesDialog open={tplOpen} onOpenChange={setTplOpen} templates={tpls.templates} variaveis={tpls.variaveis} />}
      {viewing && <ContractDialog id={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function payload(f: Client) {
  const { contact: _c, deal: _d, contracts: _k, id: _i, ...rest } = f; // eslint-disable-line @typescript-eslint/no-unused-vars
  return { ...rest, valor: Number(rest.valor) } as unknown as Partial<Client>;
}

function ContractDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["contract", id], queryFn: () => api<{ id: string; number: string; body: string; status: string }>(`/api/contracts/${id}`) });
  const [body, setBody] = useState("");
  useEffect(() => { if (data) setBody(data.body); }, [data]);
  const save = useMutation({
    mutationFn: () => api(`/api/contracts/${id}`, { method: "PATCH", json: { body } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["contract", id] }); onClose(); },
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={data ? `Contrato nº ${data.number}` : "Contrato"} side="right">
      {!data ? <p className="text-sm text-slate-500">Carregando…</p> : (
        <div className="space-y-3">
          {data.status === "DRAFT" ? (
            <>
              <p className="text-xs text-slate-500">Rascunho: ajuste o texto se precisar. Trechos com ________ são dados que faltavam na ficha.</p>
              <Textarea rows={28} className="font-mono text-xs" value={body} onChange={(e) => setBody(e.target.value)} />
              <div className="flex gap-2">
                <Button onClick={() => save.mutate()} disabled={save.isPending || body === data.body}>Salvar texto</Button>
                <a href={`/api/contracts/${id}/pdf`} target="_blank" rel="noreferrer"><Button variant="outline">Abrir PDF</Button></a>
              </div>
            </>
          ) : (
            <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-xs">{data.body}</pre>
          )}
        </div>
      )}
    </Dialog>
  );
}
