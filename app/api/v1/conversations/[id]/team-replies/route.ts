import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { requireKey, UUID } from "@/lib/api/auth.ts";
import { teamReply } from "@/lib/api/teamReply.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A reply from a member of the team working in a CRM or helpdesk, delivered to the customer through Orchestra. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured" }, { status: 503 });
  const sql = db();
  await ensureSeeded(sql);
  const key = await requireKey(sql, req);
  if (key instanceof Response) return key;
  if (!UUID.test(id)) return Response.json({ error: "not_found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const out = await teamReply(sql, id, body ?? {}, key.name);
  if ("error" in out) return Response.json(out, { status: out.error === "not_found" ? 404 : out.error === "taken_over_by_someone_else" ? 409 : 400 });
  return Response.json(out);
}
