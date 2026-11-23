import { db } from "@/lib/db.ts";
import { changeOwnPassword, currentStaff } from "@/lib/auth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Change your own password (also how a temporary password is replaced at first sign-in). */
export async function POST(req: Request) {
  if (!process.env.DATABASE_URL) return Response.json({ ok: false }, { status: 503 });
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  const sql = db();
  const me = await currentStaff(sql, req);
  if (!me) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { current?: unknown; next?: unknown } | null;
  const out = await changeOwnPassword(sql, me, body?.current, body?.next);
  return Response.json(out, { status: out.ok ? 200 : 400 });
}
