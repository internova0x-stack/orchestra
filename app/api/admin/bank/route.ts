import { db } from "@/lib/db.ts";
import { requirePermission } from "@/lib/auth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Which bank Orchestra talks to (the Bank Connector API): the simulated bank, or a real one from Vercel's settings. */
export async function GET(req: Request) {
  if (!process.env.DATABASE_URL) return Response.json({}, { status: 503 });
  const sql = db();
  const viewer = await requirePermission(sql, req, "api_view");
  if (viewer instanceof Response) return viewer;
  const url = process.env.BANK_API_URL?.trim();
  const key = Boolean(process.env.BANK_API_KEY?.trim());
  let host: string | null = null;
  try { host = url ? new URL(url).host : null; } catch { host = "an address that isn't valid"; }
  const recent = await sql<{ n: number }[]>`select count(*)::int as n from audit_log where created_at > now() - interval '7 days' and tool is not null and kind = 'lookup'`;
  return Response.json({
    mode: url && key ? "live" : "simulated", host, urlSet: Boolean(url), keySet: key, lookupsWeek: recent[0].n,
    referenceServer: key ? "on" : "off (set BANK_API_KEY to serve /api/bank/v1)",
  }, { headers: { "Cache-Control": "no-store" } });
}
