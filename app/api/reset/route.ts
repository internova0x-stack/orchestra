import { requirePermission } from "@/lib/auth.ts";
import { db } from "@/lib/db.ts";
import { seed } from "@/lib/seed.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Reset demo: wipe everything and reload the starting sample data, dated from now. */
export async function POST(req: Request) {
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured" }, { status: 503 });
  const sql = db();
  const staff = await requirePermission(sql, req, "demo_reset");
  if (staff instanceof Response) return staff;
  try {
    await seed(sql);
    return Response.json({ ok: true });
  } catch (err) {
    console.error(err);
    return Response.json({ error: "reset_failed" }, { status: 500 });
  }
}
