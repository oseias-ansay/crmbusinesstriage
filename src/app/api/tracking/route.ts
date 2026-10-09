/** Rastreamento: últimos eventos enviados à Meta + leads e vendas por anúncio. */
import { desc, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db";
import { contacts, conversionEvents, deals } from "@/db/schema";
import { route } from "@/lib/api";

export const GET = route(async (_req, { auth }) =>
  withTenant(auth.tenantId, async (tx) => {
    const events = await tx
      .select({
        id: conversionEvents.id, eventName: conversionEvents.eventName, status: conversionEvents.status, value: conversionEvents.value,
        attempts: conversionEvents.attempts, createdAt: conversionEvents.createdAt, sentAt: conversionEvents.sentAt, response: conversionEvents.response,
        dealId: conversionEvents.dealId, dealTitle: deals.title, contactName: contacts.name,
      })
      .from(conversionEvents)
      .leftJoin(deals, eq(deals.id, conversionEvents.dealId))
      .leftJoin(contacts, eq(contacts.id, conversionEvents.contactId))
      .orderBy(desc(conversionEvents.createdAt))
      .limit(100);

    // Desempenho por anúncio (do 1º clique registrado no contato)
    const ads = await tx.execute(sql`
      select coalesce(c.attribution->>'headline', c.attribution->>'adId', '(sem título)') as anuncio,
             c.attribution->>'channel' as canal,
             count(distinct c.id)::int as leads,
             count(distinct d.id) filter (where d.status = 'WON')::int as vendas,
             coalesce(sum(d.value) filter (where d.status = 'WON'), 0)::float as receita
        from contacts c
        left join deals d on d.contact_id = c.id
       where c.attribution ? 'channel'
       group by 1, 2
       order by leads desc
       limit 50`);
    const totals = await tx.execute(sql`
      select count(*) filter (where status = 'SENT')::int as enviados,
             count(*) filter (where status = 'PENDING')::int as pendentes,
             count(*) filter (where status = 'FAILED')::int as falhas
        from conversion_events`);
    return { events, ads: ads.rows, totals: totals.rows[0] };
  }),
);
