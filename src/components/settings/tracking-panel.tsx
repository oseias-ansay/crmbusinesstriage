"use client";
/** Rastreamento: desempenho por anúncio e eventos enviados à Meta. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { api } from "@/lib/fetcher";
import { brl } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Ev = { id: string; eventName: string; status: string; value: string | null; attempts: number; createdAt: string; sentAt: string | null; response: Record<string, unknown> | null; dealTitle: string | null; contactName: string | null };
type Ad = { anuncio: string; canal: string; leads: number; vendas: number; receita: number };
type T = { events: Ev[]; ads: Ad[]; totals: { enviados: number; pendentes: number; falhas: number } };

const COR: Record<string, string> = { SENT: "#10B981", PENDING: "#F59E0B", FAILED: "#EF4444", SKIPPED: "#94A3B8" };
const ROT: Record<string, string> = { SENT: "enviado", PENDING: "na fila", FAILED: "falhou", SKIPPED: "ignorado" };

export function TrackingPanel() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["tracking"], queryFn: () => api<T>("/api/tracking"), refetchInterval: 30_000 });
  const retry = useMutation({ mutationFn: () => api("/api/tracking/retry", { method: "POST" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["tracking"] }) });
  if (!data) return <p className="text-sm text-slate-500">Carregando…</p>;
  const erro = (r: Ev["response"]) => {
    const e = (r?.error as { message?: string; error_user_msg?: string } | undefined);
    return e?.error_user_msg ?? e?.message ?? (r?.erro as string | undefined) ?? (r?.motivo as string | undefined) ?? (r?.http ? `HTTP ${r.http}` : undefined);
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {[["Enviados à Meta", data.totals.enviados, "#10B981"], ["Na fila", data.totals.pendentes, "#F59E0B"], ["Com falha", data.totals.falhas, "#EF4444"]].map(([l, v, c]) => (
          <Card key={l as string} className="p-4"><p className="text-xs text-slate-500">{l}</p><p className="text-2xl font-semibold" style={{ color: c as string }}>{v as number}</p></Card>
        ))}
      </div>

      <Card className="overflow-x-auto">
        <h3 className="border-b p-3 text-sm font-semibold">Leads e vendas por anúncio</h3>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-2">Anúncio</th><th className="p-2">Origem</th><th className="p-2 text-right">Leads</th><th className="p-2 text-right">Vendas</th><th className="p-2 text-right">Conversão</th><th className="p-2 text-right">Receita</th></tr></thead>
          <tbody className="divide-y">
            {data.ads.map((a) => (
              <tr key={a.anuncio + a.canal}>
                <td className="p-2">{a.anuncio}</td>
                <td className="p-2 text-xs text-slate-500">{a.canal === "meta_ctwa" ? "Clique para WhatsApp" : a.canal === "meta_site" ? "Site (Meta)" : a.canal}</td>
                <td className="p-2 text-right">{a.leads}</td><td className="p-2 text-right">{a.vendas}</td>
                <td className="p-2 text-right">{a.leads ? Math.round((a.vendas / a.leads) * 100) : 0}%</td>
                <td className="p-2 text-right">{brl(a.receita)}</td>
              </tr>
            ))}
            {!data.ads.length && <tr><td colSpan={6} className="p-4 text-center text-slate-400">Nenhum lead de anúncio ainda. Eles aparecem aqui a partir da primeira mensagem vinda de um anúncio.</td></tr>}
          </tbody>
        </table>
      </Card>

      <Card className="overflow-x-auto">
        <div className="flex items-center border-b p-3">
          <h3 className="mr-auto text-sm font-semibold">Últimos eventos da jornada</h3>
          {data.totals.falhas > 0 && <Button size="sm" variant="outline" onClick={() => retry.mutate()} disabled={retry.isPending}><RotateCcw size={13} /> Reenviar falhas</Button>}
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-2">Quando</th><th className="p-2">Evento</th><th className="p-2">Negócio</th><th className="p-2">Situação</th><th className="p-2">Detalhe</th></tr></thead>
          <tbody className="divide-y">
            {data.events.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap p-2 text-xs">{format(new Date(e.createdAt), "dd/MM HH:mm")}</td>
                <td className="p-2 font-medium">{e.eventName}{e.value && <span className="ml-1 text-xs text-slate-500">{brl(Number(e.value))}</span>}</td>
                <td className="p-2">{e.dealTitle ?? e.contactName ?? "—"}</td>
                <td className="p-2"><Badge color={COR[e.status]}>{ROT[e.status] ?? e.status}</Badge>{e.attempts > 1 && <span className="ml-1 text-xs text-slate-400">{e.attempts}×</span>}</td>
                <td className="max-w-xs truncate p-2 text-xs text-slate-500" title={JSON.stringify(e.response ?? {})}>{e.status === "SENT" ? `recebido ${e.sentAt ? format(new Date(e.sentAt), "dd/MM HH:mm") : ""}` : erro(e.response) ?? ""}</td>
              </tr>
            ))}
            {!data.events.length && <tr><td colSpan={5} className="p-4 text-center text-slate-400">Nenhum evento ainda. Ligue a integração em Integrações.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
