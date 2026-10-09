/**
 * GET  /api/deals?pipelineId=&userId=&tag=&from=&to=&minValue=&maxValue=&q=
 *      → negócios do pipeline com indicadores para os cards do Kanban
 * POST /api/deals → cria negócio (e contato, se enviado) + dispara DEAL_CREATED
 */
import { and, asc, eq, gte, ilike, inArray, lte, sql, type SQL } from "drizzle-orm";
import { withTenant } from "@/db";
import { contacts, dealTags, deals, tags, tasks, users } from "@/db/schema";
import { ApiError, parseBody, route } from "@/lib/api";
import { dealCreateSchema } from "@/lib/validators";
import { createDeal } from "@/lib/services/deals";
import { emitToTenant } from "@/lib/realtime";
import { fireTrigger } from "@/lib/automation/engine";

export const GET = route(async (req, { auth }) => {
  const sp = new URL(req.url).searchParams;
  const pipelineId = sp.get("pipelineId");
  if (!pipelineId) throw new ApiError(400, "pipelineId obrigatório");

  const filters: SQL[] = [eq(deals.tenantId, auth.tenantId), eq(deals.pipelineId, pipelineId)];
  if (sp.get("userId")) filters.push(eq(deals.userId, sp.get("userId")!));
  if (sp.get("from")) filters.push(gte(deals.createdAt, new Date(sp.get("from")!)));
  if (sp.get("to")) filters.push(lte(deals.createdAt, new Date(sp.get("to")!)));
  if (sp.get("minValue")) filters.push(gte(deals.value, sp.get("minValue")!));
  if (sp.get("maxValue")) filters.push(lte(deals.value, sp.get("maxValue")!));
  if (sp.get("q")) filters.push(ilike(deals.title, `%${sp.get("q")}%`));
  if (sp.get("tag")) {
    filters.push(
      inArray(
        deals.id,
        sql`(select ${dealTags.dealId} from ${dealTags} join ${tags} on ${tags.id} = ${dealTags.tagId} where ${tags.name} = ${sp.get("tag")})`,
      ),
    );
  }
  // Agentes só veem os próprios negócios
  if (auth.role === "AGENT") filters.push(eq(deals.userId, auth.userId));

  return withTenant(auth.tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: deals.id,
        title: deals.title,
        value: deals.value,
        recurring: deals.recurring,
        status: deals.status,
        stageId: deals.stageId,
        position: deals.position,
        stageEnteredAt: deals.stageEnteredAt,
        expectedCloseAt: deals.expectedCloseAt,
        createdAt: deals.createdAt,
        contactId: deals.contactId,
        contactName: contacts.name,
        contactPhone: contacts.phone,
        userId: deals.userId,
        userName: users.name,
        userAvatar: users.avatarUrl,
        // indicadores do card
        overdueTasks: sql<number>`(select count(*)::int from ${tasks} t where t.deal_id = ${deals.id} and t.status = 'PENDING' and t.due_date < now())`,
        openTasks: sql<number>`(select count(*)::int from ${tasks} t where t.deal_id = ${deals.id} and t.status = 'PENDING')`,
        tags: sql<{ name: string; color: string }[]>`coalesce((select json_agg(json_build_object('name', tg.name, 'color', tg.color)) from ${dealTags} dt join ${tags} tg on tg.id = dt.tag_id where dt.deal_id = ${deals.id}), '[]'::json)`,
      })
      .from(deals)
      .leftJoin(contacts, eq(contacts.id, deals.contactId))
      .leftJoin(users, eq(users.id, deals.userId))
      .where(and(...filters))
      .orderBy(asc(deals.position));
    return rows;
  });
});

export const POST = route(async (req, { auth }) => {
  const body = await parseBody(req, dealCreateSchema);
  const deal = await withTenant(auth.tenantId, (tx) => createDeal(tx, auth.tenantId, auth.userId, body));
  emitToTenant(auth.tenantId, "deal:created", deal);
  fireTrigger(auth.tenantId, "DEAL_CREATED", { dealId: deal.id, contactId: deal.contactId ?? undefined, pipelineId: deal.pipelineId, stageId: deal.stageId, value: Number(deal.value) });
  return Response.json(deal, { status: 201 });
});
