/**
 * POST /api/deals/:id/move  { stageId, beforeId?, afterId? }
 * Mutação do Kanban (drag & drop). beforeId = card logo ACIMA do destino,
 * afterId = card logo ABAIXO. Emite socket para todos e dispara automações.
 */
import { withTenant } from "@/db";
import { parseBody, route } from "@/lib/api";
import { dealMoveSchema } from "@/lib/validators";
import { moveDeal } from "@/lib/services/deals";
import { emitToTenant } from "@/lib/realtime";
import { fireTrigger } from "@/lib/automation/engine";

export const POST = route<{ id: string }>(async (req, { auth, params }) => {
  const { stageId, beforeId, afterId } = await parseBody(req, dealMoveSchema);
  const res = await withTenant(auth.tenantId, (tx) => moveDeal(tx, auth.tenantId, auth.userId, params.id, stageId, beforeId, afterId));

  emitToTenant(auth.tenantId, "deal:moved", { ...res.deal, movedBy: auth.userId });

  if (res.stageChanged) {
    const ctx = { dealId: res.deal.id, contactId: res.deal.contactId ?? undefined, stageId, pipelineId: res.deal.pipelineId, value: Number(res.deal.value) };
    fireTrigger(auth.tenantId, "DEAL_STAGE_CHANGED", ctx);
    if (res.status === "WON") fireTrigger(auth.tenantId, "DEAL_WON", ctx);
    if (res.status === "LOST") fireTrigger(auth.tenantId, "DEAL_LOST", ctx);
  }
  return res.deal;
});
