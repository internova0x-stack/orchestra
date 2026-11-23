import { requirePermission } from "@/lib/auth.ts";
import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { dashboard } from "@/lib/dashboard.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The hours-saved dashboard's numbers, worked out fresh from the conversations and the Time saved rules. */
export async function GET(req: Request) {
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured" }, { status: 503 });
  const sql = db();
  const viewer = await requirePermission(sql, req, "dashboard_view");
  if (viewer instanceof Response) return viewer;
  await ensureSeeded(sql);
  return Response.json(await dashboard(sql), { headers: { "Cache-Control": "no-store" } });
}
