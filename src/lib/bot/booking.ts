/**
 * Blocos "Agendar atendimento" e "Inscrever em live" do robô.
 *
 * Oferta: lista numerada; o que foi oferecido fica em state.vars._offer
 * (JSON), para a resposta ser conferida contra exatamente o que o cliente viu.
 * Resposta: valida o número, grava (reunião ou inscrição), move o card,
 * agenda os lembretes e devolve para onde o fluxo segue.
 */
import { and, asc, eq, gt } from "drizzle-orm";
import type { Tx } from "@/db";
import { contactTags, dealTags, deals, liveEvents, liveRegistrations, scheduledJobs, tasks, type Contact, type Deal } from "@/db/schema";
import { moveDeal, ensureTags } from "@/lib/services/deals";
import { queueConversion } from "@/lib/meta/capi";
import { logActivity, notify } from "@/lib/activity";
import { pickNextAgent } from "@/lib/assignment";
import { renderTemplate } from "@/lib/utils";
import { findFreeSlots, formatSlot, isSlotFree } from "./slots";
import { DEFAULT_HOURS, type LiveData, type ScheduleData } from "./types";
import { createEvent } from "@/lib/google/calendar";
import type { BotTrigger } from "./engine";

type Offer = { kind: "schedule"; slots: string[]; userId: string | null } | { kind: "live"; lives: string[] };
export type OfferResult = { replies: string[]; offer: Offer } | { replies: string[]; goto: "else" };
export type AnswerResult =
  | { kind: "retry"; replies: string[]; offer?: Offer }
  | { kind: "done"; replies: string[]; goto: "next" | "else"; triggers: BotTrigger[] };

const list = (items: string[], last: string) => [...items, last].map((t, i) => `${i + 1}. ${t}`).join("\n");

/** Quem atende: fixo do bloco → responsável do negócio → rodízio. */
async function organizer(tx: Tx, tenantId: string, d: ScheduleData, deal?: Deal) {
  return d.userId || deal?.userId || (await pickNextAgent(tx, tenantId)) || null;
}

// ───────────────────────── Agendamento ─────────────────────────

export async function offerSlots(tx: Tx, tenantId: string, d: ScheduleData, deal: Deal | undefined, vars: Record<string, unknown>, notice?: string): Promise<OfferResult> {
  const userId = await organizer(tx, tenantId, d, deal);
  const slots = await findFreeSlots(tx, {
    tenantId,
    userId,
    durationMin: d.durationMin ?? 30,
    count: d.slots ?? 4,
    minLeadMin: d.minLeadMin ?? 120,
    daysAhead: d.daysAhead ?? 7,
    hours: d.hours,
  });
  if (!slots.length) return { replies: [notice ?? "No momento não encontrei horários livres na agenda."].filter(Boolean), goto: "else" };
  const tz = d.hours?.tz || DEFAULT_HOURS.tz;
  const text = `${notice ? `${notice}\n\n` : ""}${renderTemplate(d.intro, vars)}\n${list(slots.map((s) => formatSlot(s, tz)), "Nenhum desses horários")}`;
  return { replies: [text], offer: { kind: "schedule", slots: slots.map((s) => s.toISOString()), userId } };
}

export async function answerSlot(
  tx: Tx,
  ctx: { tenantId: string; d: ScheduleData; deal?: Deal; contact: Contact; vars: Record<string, unknown>; offer: Extract<Offer, { kind: "schedule" }>; answer: string },
): Promise<AnswerResult> {
  const { tenantId, d, deal, contact, offer } = ctx;
  const n = Number(ctx.answer.trim().replace(/\D/g, ""));
  if (!n || n < 1 || n > offer.slots.length + 1) {
    const tz = d.hours?.tz || DEFAULT_HOURS.tz;
    return { kind: "retry", replies: [`Responda com o número de uma opção:\n${list(offer.slots.map((s) => formatSlot(new Date(s), tz)), "Nenhum desses horários")}`] };
  }
  if (n === offer.slots.length + 1) return { kind: "done", replies: [], goto: "else", triggers: [] };

  const slot = new Date(offer.slots[n - 1]);
  const dur = d.durationMin ?? 30;
  // Outro lead pode ter escolhido o mesmo horário segundos antes
  if (!(await isSlotFree(tx, tenantId, offer.userId, slot, dur))) {
    const again = await offerSlots(tx, tenantId, d, deal, ctx.vars, "Esse horário acabou de ser reservado. Veja os próximos disponíveis:");
    if ("goto" in again) return { kind: "done", replies: again.replies, goto: "else", triggers: [] };
    return { kind: "retry", replies: again.replies, offer: again.offer };
  }

  const tz = d.hours?.tz || DEFAULT_HOURS.tz;
  const quando = formatSlot(slot, tz);
  const userId = offer.userId ?? deal?.userId ?? null;
  const triggers: BotTrigger[] = [];
  let taskId: string | null = null;

  // Google Agenda da empresa: evento com link do Meet próprio (e convite ao lead)
  const gev = await createEvent(tenantId, {
    summary: `Atendimento Business Triage — ${contact.name}`,
    description: `Atendimento de ${dur} min agendado pelo WhatsApp.\nContato: ${contact.name} · ${contact.phone ?? ""}${contact.email ? ` · ${contact.email}` : ""}`,
    start: slot,
    durationMin: dur,
    attendeeEmail: contact.email,
    requestId: `crm-${contact.id}-${slot.getTime()}`,
  });
  const link = gev?.meetLink || d.meetingLink || "";

  if (userId) {
    const [t] = await tx
      .insert(tasks)
      .values({
        tenantId,
        userId,
        dealId: deal?.id ?? null,
        contactId: contact.id,
        type: "MEETING",
        title: `Atendimento (${dur} min) — ${contact.name}`,
        description: `Agendado pelo robô no WhatsApp.${link ? `\nLink: ${link}` : ""}\nTelefone: ${contact.phone ?? "-"}${gev ? "\nNo Google Agenda da empresa." : ""}`,
        dueDate: slot,
        durationMin: dur,
        externalRef: gev?.id ?? null,
        meetLink: link || null,
      })
      .returning({ id: tasks.id });
    taskId = t.id;
    await notify(tx, { tenantId, userId, title: "Novo atendimento agendado", body: `${contact.name} — ${quando}`, link: "/tasks" });
  }
  if (deal) {
    if (userId && !deal.userId) await tx.update(deals).set({ userId }).where(eq(deals.id, deal.id));
    if (d.stageId && d.stageId !== deal.stageId) {
      const m = await moveDeal(tx, tenantId, null, deal.id, d.stageId);
      if (m.stageChanged) triggers.push({ type: "DEAL_STAGE_CHANGED", ctx: { dealId: deal.id, stageId: d.stageId, pipelineId: m.deal.pipelineId } });
    }
    await queueConversion(tx, tenantId, { dealId: deal.id, eventName: "Schedule" });
    await logActivity(tx, { tenantId, type: "AUTOMATION", summary: `Robô: atendimento agendado para ${quando}`, dealId: deal.id, contactId: contact.id, meta: { slot: slot.toISOString(), taskId, googleEventId: gev?.id ?? null } });
  }

  // Lembrete ao contato antes do horário (só se a reunião continuar marcada)
  const remind = d.reminderMin ?? 60;
  const at = new Date(slot.getTime() - remind * 60_000);
  if (taskId && at.getTime() > Date.now() + 5 * 60_000) {
    const hora = quando.split(", às ")[1] ?? quando;
    await tx.insert(scheduledJobs).values({
      tenantId,
      kind: "CONTACT_MESSAGE",
      runAt: at,
      payload: {
        contactId: contact.id,
        requireTaskId: taskId,
        text: `Lembrete: seu atendimento com a Business Triage é hoje, às ${hora}.${link ? ` Link da videochamada: ${link}` : ""} Se precisar remarcar, é só responder aqui.`,
      },
    });
  }

  const linkTexto = link ? `Link da videochamada: ${link}` : "O link da videochamada será enviado antes do horário.";
  const text = renderTemplate(d.confirmText, { ...ctx.vars, agendamento: { data: quando, link, linkTexto, duracao: dur } });
  return { kind: "done", replies: [text], goto: "next", triggers };
}

// ───────────────────────── Live ─────────────────────────

export async function offerLives(tx: Tx, d: LiveData, vars: Record<string, unknown>): Promise<OfferResult> {
  const lives = await tx
    .select()
    .from(liveEvents)
    .where(and(eq(liveEvents.isActive, true), gt(liveEvents.startsAt, new Date(Date.now() + 15 * 60_000))))
    .orderBy(asc(liveEvents.startsAt))
    .limit(d.max ?? 3);
  if (!lives.length) return { replies: d.noLivesText ? [renderTemplate(d.noLivesText, vars)] : [], goto: "else" };
  const items = lives.map((l) => `${l.title} — ${formatSlot(l.startsAt)}`);
  return { replies: [`${renderTemplate(d.intro, vars)}\n${list(items, "Agora não, obrigado")}`], offer: { kind: "live", lives: lives.map((l) => l.id) } };
}

export async function answerLive(
  tx: Tx,
  ctx: { tenantId: string; d: LiveData; deal?: Deal; contact: Contact; vars: Record<string, unknown>; offer: Extract<Offer, { kind: "live" }>; answer: string },
): Promise<AnswerResult> {
  const { tenantId, d, deal, contact, offer } = ctx;
  const n = Number(ctx.answer.trim().replace(/\D/g, ""));
  if (!n || n < 1 || n > offer.lives.length + 1) {
    const again = await offerLives(tx, d, ctx.vars);
    if ("goto" in again) return { kind: "done", replies: again.replies, goto: "else", triggers: [] };
    return { kind: "retry", replies: [`Responda com o número de uma opção.\n\n${again.replies[0]}`], offer: again.offer };
  }
  if (n === offer.lives.length + 1) return { kind: "done", replies: [], goto: "else", triggers: [] };

  const [live] = await tx.select().from(liveEvents).where(eq(liveEvents.id, offer.lives[n - 1])).limit(1);
  if (!live) return { kind: "done", replies: ["Essa live não está mais disponível."], goto: "else", triggers: [] };

  const [reg] = await tx
    .insert(liveRegistrations)
    .values({ tenantId, liveId: live.id, contactId: contact.id, dealId: deal?.id ?? null })
    .onConflictDoNothing()
    .returning({ id: liveRegistrations.id });
  const quando = formatSlot(live.startsAt);
  const [tag] = await ensureTags(tx, tenantId, ["Live"]);
  await tx.insert(contactTags).values({ tenantId, contactId: contact.id, tagId: tag.id }).onConflictDoNothing();
  if (deal) {
    await tx.insert(dealTags).values({ tenantId, dealId: deal.id, tagId: tag.id }).onConflictDoNothing();
    await queueConversion(tx, tenantId, { dealId: deal.id, eventName: "CompleteRegistration" });
    await logActivity(tx, { tenantId, type: "AUTOMATION", summary: `Robô: inscrito na live "${live.title}" (${quando})`, dealId: deal.id, contactId: contact.id, meta: { liveId: live.id } });
  }

  // Lembretes: véspera (se faltar mais de 24 h) e 30 min antes, com o link
  if (reg) {
    const jobs: { at: Date; text: string }[] = [];
    const day = new Date(live.startsAt.getTime() - 24 * 3_600_000);
    if (day.getTime() > Date.now() + 3_600_000) jobs.push({ at: day, text: `Amanhã tem live: "${live.title}", ${quando.split(", ").slice(-1)[0]}. Vou te mandar o link 30 minutos antes.` });
    const soon = new Date(live.startsAt.getTime() - 30 * 60_000);
    if (soon.getTime() > Date.now()) jobs.push({ at: soon, text: `A live "${live.title}" começa em 30 minutos.${live.link ? ` Link: ${live.link}` : ""}` });
    for (const j of jobs) {
      await tx.insert(scheduledJobs).values({ tenantId, kind: "CONTACT_MESSAGE", runAt: j.at, payload: { contactId: contact.id, requireLiveRegistrationId: reg.id, text: j.text } });
    }
  }
  const text = renderTemplate(d.confirmText, { ...ctx.vars, live: { titulo: live.title, data: quando, link: live.link ?? "", descricao: live.description ?? "" } });
  return { kind: "done", replies: [text], goto: "next", triggers: [] };
}
