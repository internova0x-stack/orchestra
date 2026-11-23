import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { needsSetup, signIn } from "@/lib/auth.ts";
import { sessionCookie } from "@/lib/authCookie.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whether the console still needs its first account (the sign-in page then offers to create it). */
export async function GET() {
  if (!process.env.DATABASE_URL) return Response.json({ needsSetup: false, error: "not_configured" }, { status: 503 });
  const sql = db();
  await ensureSeeded(sql);
  return Response.json({ needsSetup: await needsSetup(sql) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  if (!process.env.DATABASE_URL) return Response.json({ ok: false, error: "The database isn't connected." }, { status: 503 });
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  const sql = db();
  await ensureSeeded(sql);
  const body = (await req.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
  const out = await signIn(sql, body?.email, body?.password, req.headers.get("user-agent"));
  if (!out.ok) return Response.json(out, { status: 401 });
  return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(out.token, req) } });
}
