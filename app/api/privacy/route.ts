import { requirePermission } from "@/lib/auth.ts";
import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { erasurePreview, eraseCustomer } from "@/lib/privacy.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Delete a customer's data on their request (Messages → the conversation → Delete this customer's data). */
export async function POST(req: Request) {
  if (!process.env.DATABASE_URL) return Response.json({ ok: false }, { status: 503 });
  const sql = db();
  const s = await requirePermission(sql, req, "data_erase");
  if (s instanceof Response) return s;
  await ensureSeeded(sql);
  const body = (await req.json().catch(() => ({}))) as { action?: string; conversation_id?: string };
  const id = String(body.conversation_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  const out = body.action === "preview" ? await erasurePreview(sql, id) : body.action === "erase" ? await eraseCustomer(sql, s, id) : { ok: false as const, error: "bad_request" };
  return Response.json(out, { status: out.ok ? 200 : 400, headers: { "Cache-Control": "no-store" } });
}
