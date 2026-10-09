"use client";
/**
 * Dashboard analítico: KPIs, funil com conversão por etapa, evolução semanal,
 * motivos de perda, origem dos leads e produtividade da equipe.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Clock, Percent, Target, TrendingUp, Trophy, Wallet } from "lucide-react";
import { api } from "@/lib/fetcher";
import { brl } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/input";

type Metrics = {
  kpis: {
    pipeline_value: number; weighted_forecast: number; open_deals: number; won_value: number; won_count: number;
    lost_count: number; mrr: number; avg_days_to_close: number | null; new_deals: number; win_rate: number; avg_ticket: number;
  };
  funnel: { stage_id: string; name: string; color: string; deals: number; conversion: number; avg_hours: number | null }[];
  lossReasons: { name: string; total: number }[];
  team: { user_id: string; name: string; won_count: number; won_value: number; tasks_done: number; messages_sent: number; open_deals: number }[];
  timeline: { week: string; won: number; lost: number; created: number; won_value: number }[];
  sources: { source: string; total: number }[];
};
type Pipeline = { id: string; name: string };

const PERIODS = [
  { label: "Últimos 30 dias", days: 30 },
  { label: "Últimos 90 dias", days: 90 },
  { label: "Últimos 12 meses", days: 365 },
];

function Kpi({ icon: Icon, label, value, hint }: { icon: typeof Wallet; label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="flex items-start gap-4">
        <span className="rounded-lg bg-secondary/10 p-2 text-secondary"><Icon size={20} /></span>
        <div>
          <p className="text-xs text-slate-500">{label}</p>
          <p className="text-2xl font-semibold tabular-nums">{value}</p>
          {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

export function MetricsDashboard() {
  const [days, setDays] = useState(90);
  const [pipelineId, setPipelineId] = useState("");
  const { data: pipelines = [] } = useQuery({ queryKey: ["pipelines"], queryFn: () => api<Pipeline[]>("/api/pipelines") });
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", days, pipelineId],
    queryFn: () => api<Metrics>(`/api/dashboard?from=${from}${pipelineId ? `&pipelineId=${pipelineId}` : ""}`),
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <div className="flex gap-2">
          <Select value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
            <option value="">Todos os funis</option>
            {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {PERIODS.map((p) => <option key={p.days} value={p.days}>{p.label}</option>)}
          </Select>
        </div>
      </div>

      {isLoading || !data ? (
        <p className="text-sm text-slate-500">Carregando métricas…</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Kpi icon={Wallet} label="Valor em pipeline (aberto)" value={brl(data.kpis.pipeline_value, true)} hint={`${data.kpis.open_deals} negócios abertos`} />
            <Kpi icon={Target} label="Forecast ponderado" value={brl(data.kpis.weighted_forecast, true)} hint="valor × probabilidade da etapa" />
            <Kpi icon={Trophy} label="Vendido no período" value={brl(data.kpis.won_value, true)} hint={`${data.kpis.won_count} ganhos · ticket ${brl(data.kpis.avg_ticket, true)}`} />
            <Kpi icon={Percent} label="Taxa de conversão" value={`${(data.kpis.win_rate * 100).toFixed(1)}%`} hint={`${data.kpis.won_count} ganhos / ${data.kpis.lost_count} perdidos`} />
            <Kpi icon={Clock} label="Tempo médio de fechamento" value={data.kpis.avg_days_to_close ? `${data.kpis.avg_days_to_close.toFixed(1)} dias` : "—"} />
            <Kpi icon={TrendingUp} label="MRR (recorrente ganho)" value={brl(data.kpis.mrr, true)} hint={`ARR ${brl(data.kpis.mrr * 12, true)}`} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Funil — conversão por etapa</CardTitle></CardHeader>
              <CardContent className="h-80">
                <ResponsiveContainer>
                  <BarChart data={data.funnel} layout="vertical" margin={{ left: 40 }}>
                    <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                    <XAxis type="number" allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12 }} />
                    <Tooltip
                      formatter={(v: number, _n, p) => [`${v} negócios · ${(p.payload.conversion * 100).toFixed(0)}% da etapa anterior${p.payload.avg_hours ? ` · ${(p.payload.avg_hours / 24).toFixed(1)}d na etapa` : ""}`, ""]}
                    />
                    <Bar dataKey="deals" radius={[0, 6, 6, 0]}>
                      {data.funnel.map((s) => <Cell key={s.stage_id} fill={s.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Evolução semanal</CardTitle></CardHeader>
              <CardContent className="h-80">
                <ResponsiveContainer>
                  <ComposedChart data={data.timeline}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="n" allowDecimals={false} />
                    <YAxis yAxisId="v" orientation="right" tickFormatter={(v) => brl(v, true)} />
                    <Tooltip formatter={(v: number, n) => (n === "Receita ganha" ? brl(v) : v)} />
                    <Legend />
                    <Bar yAxisId="n" dataKey="created" name="Novos" fill="rgb(var(--color-primary) / 0.25)" />
                    <Bar yAxisId="n" dataKey="won" name="Ganhos" fill="#10B981" />
                    <Bar yAxisId="n" dataKey="lost" name="Perdidos" fill="#EF4444" />
                    <Line yAxisId="v" dataKey="won_value" name="Receita ganha" stroke="rgb(var(--color-secondary))" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Motivos de perda</CardTitle></CardHeader>
              <CardContent className="h-72">
                {data.lossReasons.length === 0 ? (
                  <p className="text-sm text-slate-500">Nenhuma perda no período.</p>
                ) : (
                  <ResponsiveContainer>
                    <BarChart data={data.lossReasons}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="total" name="Negócios" fill="#EF4444" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Origem dos leads</CardTitle></CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer>
                  <BarChart data={data.sources} layout="vertical" margin={{ left: 20 }}>
                    <XAxis type="number" allowDecimals={false} />
                    <YAxis type="category" dataKey="source" width={110} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="total" name="Leads" fill="rgb(var(--color-primary))" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Produtividade da equipe</CardTitle></CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-5 py-2">Responsável</th>
                    <th className="px-5 py-2 text-right">Abertos</th>
                    <th className="px-5 py-2 text-right">Ganhos</th>
                    <th className="px-5 py-2 text-right">Receita</th>
                    <th className="px-5 py-2 text-right">Tarefas concluídas</th>
                    <th className="px-5 py-2 text-right">Mensagens enviadas</th>
                  </tr>
                </thead>
                <tbody>
                  {data.team.map((u) => (
                    <tr key={u.user_id} className="border-t">
                      <td className="px-5 py-2 font-medium">{u.name}</td>
                      <td className="px-5 py-2 text-right tabular-nums">{u.open_deals}</td>
                      <td className="px-5 py-2 text-right tabular-nums">{u.won_count}</td>
                      <td className="px-5 py-2 text-right tabular-nums">{brl(u.won_value)}</td>
                      <td className="px-5 py-2 text-right tabular-nums">{u.tasks_done}</td>
                      <td className="px-5 py-2 text-right tabular-nums">{u.messages_sent}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
