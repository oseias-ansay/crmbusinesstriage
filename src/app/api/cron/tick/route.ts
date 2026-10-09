/**
 * Alternativa ao worker em processo (útil em Vercel/serverless):
 * agende um cron externo chamando POST /api/cron/tick com header
 * Authorization: Bearer <CRON_SECRET> a cada 1 minuto.
 */
import { NextResponse } from "next/server";
import { processScheduledJobs, processTaskReminders } from "@/lib/automation/worker";

export async function POST(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const jobs = await processScheduledJobs();
  const reminders = await processTaskReminders();
  return NextResponse.json({ jobs, reminders });
}
export const GET = POST;
