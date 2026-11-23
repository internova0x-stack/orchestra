import { db } from "@/lib/db.ts";
import { editRule } from "@/lib/ruleEdit.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Edit one rule. It applies to Alexis's next message, since tools read the rules on every call. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { value?: unknown } | null;
  if (typeof body?.value !== "string") return Response.json({ ok: false, error: "A value is needed." }, { status: 400 });
  if (!process.env.DATABASE_URL) return Response.json({ ok: false, error: "The database isn't connected." }, { status: 503 });
  const out = await editRule(db(), id, body.value);
  return Response.json(out, { status: out.ok ? 200 : 400 });
}
