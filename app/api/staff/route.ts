import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The case list: open cases first, newest first. */
export async function GET() {
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured", cases: [] }, { status: 503 });
  const sql = db();
  await ensureSeeded(sql);
  const cases = await sql`
    select e.reference, e.urgency, e.status, e.created_at, e.summary->>'why' as trigger, b.name as business, e.action
    from escalations e left join businesses b on b.id = e.business_id
    order by (e.status = 'open') desc, e.created_at desc limit 100`;
  return Response.json({ cases }, { headers: { "Cache-Control": "no-store" } });
}
