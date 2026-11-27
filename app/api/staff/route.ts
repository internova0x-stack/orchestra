import { applyRetention } from "@/lib/privacy.ts";
import { requirePermission } from "@/lib/auth.ts";
import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { flagOverdue, teams } from "@/lib/routing.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The case list: open cases first (overdue first), newest first, with each case's team and who has it. */
export async function GET(req: Request) {
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured", cases: [] }, { status: 503 });
  const sql = db();
  const viewer = await requirePermission(sql, req, "staff_queue_view");
  if (viewer instanceof Response) return viewer;
  await ensureSeeded(sql);
  await flagOverdue(sql);
  // Conversations and activity past the retention periods (Rules screen, Data protection), at most once an hour.
  await applyRetention(sql).catch((err) => console.error("retention", err));
  const cases = await sql`
    select e.reference, e.urgency, e.status, e.created_at, e.summary->>'why' as trigger, b.name as business, e.action,
      e.team, e.assigned_to, e.respond_by, e.overdue_at is not null as overdue
    from escalations e left join businesses b on b.id = e.business_id
    order by (e.status = 'open') desc, (e.status = 'open' and e.overdue_at is not null and e.assigned_to is null) desc, e.created_at desc limit 100`;
  return Response.json({ cases, teams: await teams(sql) }, { headers: { "Cache-Control": "no-store" } });
}
