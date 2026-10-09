/**
 * Horários livres para o robô oferecer.
 * Expediente e feriados vêm do mesmo cálculo do "fora do horário".
 * Conflito = reunião pendente do mesmo responsável que se sobrepõe ao horário.
 */
import { and, eq, gte, lte } from "drizzle-orm";
import type { Tx } from "@/db";
import { tasks } from "@/db/schema";
import { DEFAULT_HOURS, WEEK, isBusinessDate, type HandoffData } from "./types";
import { busyIntervals } from "@/lib/google/calendar";

const pad = (n: number) => String(n).padStart(2, "0");

/** Partes da data no fuso informado. */
export function localParts(d: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute) };
}

/** Horário local (no fuso) → Date UTC. Corrige o deslocamento do fuso (com ou sem horário de verão). */
export function localToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string) {
  let t = Date.UTC(y, m - 1, d, h, mi);
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(t), tz);
    const diff = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - Date.UTC(y, m - 1, d, h, mi);
    t -= diff;
  }
  return new Date(t);
}

/** "quinta-feira, 09/10, às 10h" / "às 14h30" */
export function formatSlot(d: Date, tz = DEFAULT_HOURS.tz) {
  const p = localParts(d, tz);
  const wd = WEEK[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()];
  return `${wd}, ${pad(p.d)}/${pad(p.m)}, às ${p.h}h${p.mi ? pad(p.mi) : ""}`;
}

type Opts = {
  tenantId: string;
  userId: string | null;
  durationMin: number;
  count: number;
  minLeadMin: number;
  daysAhead: number;
  hours?: HandoffData["hours"];
  now?: Date;
};

/**
 * Até `count` horários, no máximo 2 por dia (um de manhã, um à tarde),
 * espalhados pelos próximos dias úteis — dá escolha sem lotar a mensagem.
 */
export async function findFreeSlots(tx: Tx, o: Opts): Promise<Date[]> {
  const tz = o.hours?.tz || DEFAULT_HOURS.tz;
  const [sh, sm] = (o.hours?.start || DEFAULT_HOURS.start).split(":").map(Number);
  const [eh, em] = (o.hours?.end || DEFAULT_HOURS.end).split(":").map(Number);
  const now = o.now ?? new Date();
  const earliest = new Date(now.getTime() + o.minLeadMin * 60_000);
  const horizon = new Date(now.getTime() + (o.daysAhead + 7) * 86_400_000);

  const busy = o.userId
    ? await tx
        .select({ due: tasks.dueDate, dur: tasks.durationMin })
        .from(tasks)
        .where(and(eq(tasks.userId, o.userId), eq(tasks.type, "MEETING"), eq(tasks.status, "PENDING"), gte(tasks.dueDate, new Date(now.getTime() - 86_400_000)), lte(tasks.dueDate, horizon)))
    : [];
  // Ocupados no Google Agenda da empresa (se conectado)
  const gbusy = await busyIntervals(o.tenantId, now, horizon);
  const conflicts = (start: Date) => {
    const s = start.getTime(), e = s + o.durationMin * 60_000;
    return (
      busy.some((b) => {
        const bs = b.due.getTime(), be = bs + (b.dur ?? 30) * 60_000;
        return s < be && bs < e;
      }) || gbusy.some((b) => s < b.end.getTime() && b.start.getTime() < e)
    );
  };

  const out: Date[] = [];
  const t0 = localParts(now, tz);
  let day = Date.UTC(t0.y, t0.m - 1, t0.d);
  let businessDays = 0;
  for (let i = 0; i < 30 && out.length < o.count && businessDays <= o.daysAhead; i++, day += 86_400_000) {
    const dd = new Date(day);
    const y = dd.getUTCFullYear(), m = dd.getUTCMonth() + 1, d = dd.getUTCDate();
    if (!isBusinessDate(y, m, d, o.hours?.extraHolidays)) continue;
    businessDays++;
    let morning: Date | null = null, afternoon: Date | null = null;
    for (let min = sh * 60 + sm; min + o.durationMin <= eh * 60 + em; min += 30) {
      const slot = localToUtc(y, m, d, Math.floor(min / 60), min % 60, tz);
      if (slot < earliest || conflicts(slot)) continue;
      if (min < 12 * 60) morning ??= slot;
      else if (min >= 13 * 60) afternoon ??= slot;
    }
    for (const s of [morning, afternoon]) if (s && out.length < o.count) out.push(s);
  }
  return out;
}

export async function isSlotFree(tx: Tx, tenantId: string, userId: string | null, slot: Date, durationMin: number) {
  const s0 = slot.getTime(), e0 = s0 + durationMin * 60_000;
  const g = await busyIntervals(tenantId, slot, new Date(e0));
  if (g.some((b) => s0 < b.end.getTime() && b.start.getTime() < e0)) return false;
  if (!userId) return true;
  const rows = await tx
    .select({ due: tasks.dueDate, dur: tasks.durationMin })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.type, "MEETING"), eq(tasks.status, "PENDING"), gte(tasks.dueDate, new Date(slot.getTime() - 4 * 3_600_000)), lte(tasks.dueDate, new Date(slot.getTime() + 4 * 3_600_000))));
  const s = slot.getTime(), e = s + durationMin * 60_000;
  return !rows.some((b) => {
    const bs = b.due.getTime(), be = bs + (b.dur ?? 30) * 60_000;
    return s < be && bs < e;
  });
}
