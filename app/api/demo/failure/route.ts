import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { DEMO_FAILURES as SCENARIOS, notifyFailure } from "@/lib/proactive.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Testing only (the customer app's tester panel): play the bank reporting a failed payment for a sample
 * customer, as the Events API would. All records are the simulated bank's invented ones.
 */

export async function GET() {
  return Response.json({ scenarios: SCENARIOS.map(({ id, user, label }) => ({ id, user, label })) });
}

export async function POST(req: Request) {
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured" }, { status: 503 });
  const body = (await req.json().catch(() => null)) as { scenario?: string } | null;
  const s = SCENARIOS.find((x) => x.id === body?.scenario);
  if (!s) return Response.json({ error: "bad_request" }, { status: 400 });
  const sql = db();
  await ensureSeeded(sql);
  const r = await notifyFailure(sql, s.type, { ...s.data, user_id: s.user });
  await sql`insert into audit_log (kind, tool, summary) values ('rule', 'events_api', ${`simulated event · ${s.type} · ${r.sent ? "customer messaged" : `no message (${r.why.replace(/_/g, " ")})`}`})`;
  return Response.json(r);
}
