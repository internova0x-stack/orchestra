import { requirePermission } from "@/lib/auth.ts";
import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { billing } from "@/lib/billing.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The month's plan and usage: platform fee, conversations, AI usage. ?month=YYYY-MM (default this month). */
export async function GET(req: Request) {
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured" }, { status: 503 });
  const sql = db();
  const viewer = await requirePermission(sql, req, "billing_view");
  if (viewer instanceof Response) return viewer;
  await ensureSeeded(sql);
  const month = new URL(req.url).searchParams.get("month");
  return Response.json(await billing(sql, month), { headers: { "Cache-Control": "no-store" } });
}
