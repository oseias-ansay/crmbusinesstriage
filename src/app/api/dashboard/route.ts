/**
 * GET /api/dashboard?pipelineId=&from=&to=
 * Todas as métricas do dashboard em uma chamada (SQL agregado no Postgres).
 */
import { sql } from "drizzle-orm";
import { withTenant } from "@/db";
import { route } from "@/lib/api";

export const GET = route(async (req, { auth }) => {
  const sp = new URL(req.url).searchParams;
  const to = sp.get("to") ? new Date(sp.get("to")!) : new Date();
  const from = sp.get("from") ? new Date(sp.get("from")!) : new Date(to.getTime() - 90 * 86_400_000);
  const pipelineId = sp.get("pipelineId");
  const pf = pipelineId ? sql`and d.pipeline_id = ${pipelineId}` : sql``;
  const t = auth.tenantId;

  return withTenant(t, async (tx) => {
    const q = async <R>(query: ReturnType<typeof sql>) => (await tx.execute(query)).rows as R[];

    const [kpi] = await q<Record<string, string | number | null>>(sql`
      select
        coalesce(sum(d.value) filter (where d.status = 'OPEN'), 0)::float                                as pipeline_value,
        coalesce(sum(d.value * s.probability / 100.0) filter (where d.status = 'OPEN'), 0)::float          as weighted_forecast,
        count(*) filter (where d.status = 'OPEN')::int                                                     as open_deals,
        coalesce(sum(d.value) filter (where d.status = 'WON' and d.closed_at between ${from} and ${to}), 0)::float as won_value,
        count(*) filter (where d.status = 'WON'  and d.closed_at between ${from} and ${to})::int           as won_count,
        count(*) filter (where d.status = 'LOST' and d.closed_at between ${from} and ${to})::int           as lost_count,
        coalesce(sum(d.value) filter (where d.status = 'WON' and d.recurring), 0)::float                   as mrr,
        avg(extract(epoch from (d.closed_at - d.created_at)) / 86400)
          filter (where d.status = 'WON' and d.closed_at between ${from} and ${to})::float                 as avg_days_to_close,
        count(*) filter (where d.created_at between ${from} and ${to})::int                                as new_deals
      from deals d join stages s on s.id = d.stage_id
      where d.tenant_id = ${t} ${pf}`);

    // Funil: quantos negócios passaram por cada etapa no período → conversão etapa a etapa
    const funnel = await q<{ stage_id: string; name: string; color: string; ord: number; deals: number; avg_hours: number | null }>(sql`
      select s.id as stage_id, s.name, s.color, s."order" as ord,
             count(distinct h.deal_id)::int as deals,
             (select avg(h2.duration_sec) / 3600.0 from stage_history h2 where h2.from_stage_id = s.id and h2.created_at between ${from} and ${to})::float as avg_hours
      from stages s
      left join stage_history h on h.to_stage_id = s.id and h.created_at between ${from} and ${to}
      where s.tenant_id = ${t} and s.is_lost = false
        ${pipelineId ? sql`and s.pipeline_id = ${pipelineId}` : sql`and s.pipeline_id = (select id from pipelines where tenant_id = ${t} order by is_default desc, "order" limit 1)`}
      group by s.id order by s."order"`);

    const lossReasons = await q<{ name: string; total: number }>(sql`
      select coalesce(lr.name, 'Não informado') as name, count(*)::int as total
      from deals d left join loss_reasons lr on lr.id = d.loss_reason_id
      where d.tenant_id = ${t} and d.status = 'LOST' and d.closed_at between ${from} and ${to} ${pf}
      group by 1 order by 2 desc`);

    const team = await q<{ user_id: string; name: string; won_count: number; won_value: number; tasks_done: number; messages_sent: number; open_deals: number }>(sql`
      select u.id as user_id, u.name,
        (select count(*) from deals d where d.user_id = u.id and d.status = 'WON' and d.closed_at between ${from} and ${to} ${pf})::int as won_count,
        (select coalesce(sum(d.value), 0) from deals d where d.user_id = u.id and d.status = 'WON' and d.closed_at between ${from} and ${to} ${pf})::float as won_value,
        (select count(*) from deals d where d.user_id = u.id and d.status = 'OPEN' ${pf})::int as open_deals,
        (select count(*) from tasks k where k.user_id = u.id and k.status = 'DONE' and k.completed_at between ${from} and ${to})::int as tasks_done,
        (select count(*) from messages m where m.user_id = u.id and m.timestamp between ${from} and ${to})::int as messages_sent
      from users u where u.tenant_id = ${t} and u.is_active
      order by won_value desc`);

    const timeline = await q<{ week: string; won: number; lost: number; created: number; won_value: number }>(sql`
      with weeks as (select generate_series(date_trunc('week', ${from}::timestamptz), ${to}::timestamptz, interval '1 week') as w)
      select to_char(w, 'DD/MM') as week,
        (select count(*) from deals d where d.tenant_id = ${t} and d.status = 'WON'  and date_trunc('week', d.closed_at) = w ${pf})::int as won,
        (select count(*) from deals d where d.tenant_id = ${t} and d.status = 'LOST' and date_trunc('week', d.closed_at) = w ${pf})::int as lost,
        (select count(*) from deals d where d.tenant_id = ${t} and date_trunc('week', d.created_at) = w ${pf})::int as created,
        (select coalesce(sum(d.value), 0) from deals d where d.tenant_id = ${t} and d.status = 'WON' and date_trunc('week', d.closed_at) = w ${pf})::float as won_value
      from weeks order by w`);

    const sources = await q<{ source: string; total: number }>(sql`
      select coalesce(d.source, 'outros') as source, count(*)::int as total
      from deals d where d.tenant_id = ${t} and d.created_at between ${from} and ${to} ${pf}
      group by 1 order by 2 desc limit 8`);

    const won = Number(kpi.won_count), lost = Number(kpi.lost_count);
    return {
      period: { from, to },
      kpis: { ...kpi, win_rate: won + lost ? won / (won + lost) : 0, avg_ticket: won ? Number(kpi.won_value) / won : 0 },
      funnel: funnel.map((s, i) => ({ ...s, conversion: i === 0 || !funnel[0].deals ? 1 : s.deals / (funnel[i - 1].deals || 1) })),
      lossReasons,
      team,
      timeline,
      sources,
    };
  });
});
