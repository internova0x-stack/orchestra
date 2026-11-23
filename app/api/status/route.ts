import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { operations } from "@/lib/agent.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whether Alexis is switched on, and the outage notice while outage mode is on. */
export async function GET() {
  if (!process.env.DATABASE_URL) return Response.json({ alexisOn: true, outage: null });
  const sql = db();
  await ensureSeeded(sql);
  return Response.json(await operations(sql), { headers: { "Cache-Control": "no-store" } });
}
