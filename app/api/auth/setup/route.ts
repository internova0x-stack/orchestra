import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { setupFirstAdmin, signIn } from "@/lib/auth.ts";
import { sessionCookie } from "@/lib/authCookie.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The first account (an operations admin), only while the console has none. Signs them straight in. */
export async function POST(req: Request) {
  if (!process.env.DATABASE_URL) return Response.json({ ok: false, error: "The database isn't connected." }, { status: 503 });
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  const sql = db();
  await ensureSeeded(sql);
  const body = (await req.json().catch(() => null)) as { name?: unknown; email?: unknown; password?: unknown } | null;
  const out = await setupFirstAdmin(sql, body ?? {});
  if (!out.ok) return Response.json(out, { status: 400 });
  const s = await signIn(sql, body?.email, body?.password, req.headers.get("user-agent"));
  return Response.json({ ok: true }, { headers: s.ok ? { "Set-Cookie": sessionCookie(s.token, req) } : {} });
}
