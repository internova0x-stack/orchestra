import { db } from "@/lib/db.ts";
import { requireKey, UUID } from "@/lib/api/auth.ts";
import { conversationMessages } from "@/lib/api/channel.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Channel API: the conversation so far (customer, Alexis and team messages, who is handling it). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured" }, { status: 503 });
  const sql = db();
  const key = await requireKey(sql, req);
  if (key instanceof Response) return key;
  const out = UUID.test(id) ? await conversationMessages(sql, id) : null;
  return out ? Response.json(out) : Response.json({ error: "not_found" }, { status: 404 });
}
