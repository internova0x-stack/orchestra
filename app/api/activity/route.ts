import { db } from "@/lib/db.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The activity panel: a live view of the audit log for one conversation. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const conversation = url.searchParams.get("conversation") ?? "";
  const after = Number(url.searchParams.get("after") ?? 0) || 0;
  if (!/^[0-9a-f-]{36}$/i.test(conversation)) return Response.json({ rows: [] });
  if (!process.env.DATABASE_URL) return Response.json({ rows: [] });
  const sql = db();
  const rows = await sql`
    select id, tool_use_id, kind, tool, summary, input, result, refusal_reason, approver, created_at
    from audit_log where conversation_id = ${conversation} and id > ${after}
    order by id limit 200`.catch(() => []);
  return Response.json({ rows }, { headers: { "Cache-Control": "no-store" } });
}
