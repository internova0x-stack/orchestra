import { can, requirePermission } from "@/lib/auth.ts";
import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { checkDns, disconnectEmail, emailView, practiceIncoming, setEmailLive, startEmail } from "@/lib/email/channel.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The email channel on the API page: where its setup stands. */
export async function GET(req: Request) {
  if (!process.env.DATABASE_URL) return Response.json({ connected: false }, { status: 503 });
  const sql = db();
  const viewer = await requirePermission(sql, req, "api_view");
  if (viewer instanceof Response) return viewer;
  await ensureSeeded(sql);
  return Response.json(await emailView(sql, can(viewer.role, "api_manage")), { headers: { "Cache-Control": "no-store" } });
}

/** Set it up, check DNS, go live, change mode, disconnect; in practice mode, play a forwarded email. */
export async function POST(req: Request) {
  if (!process.env.DATABASE_URL) return Response.json({ ok: false }, { status: 503 });
  const sql = db();
  const s = await requirePermission(sql, req, "api_manage");
  if (s instanceof Response) return s;
  await ensureSeeded(sql);
  const body = (await req.json().catch(() => ({}))) as { action?: string; address?: string; mode?: string; from?: string; subject?: string; text?: string };
  const out =
    body.action === "start" ? await startEmail(sql, { address: String(body.address ?? ""), staff: s, baseUrl: new URL(req.url).origin })
    : body.action === "check_dns" ? await checkDns(sql, s)
    : body.action === "live" && (body.mode === "drafts" || body.mode === "replies") ? await setEmailLive(sql, s, body.mode)
    : body.action === "disconnect" ? await disconnectEmail(sql, s)
    : body.action === "practice_email" ? await practiceIncoming(sql, {
        from: String(body.from ?? "ada.okafor@brightline.example").slice(0, 200),
        subject: String(body.subject ?? "Where is my payout?").slice(0, 200),
        text: String(body.text ?? "Hello, I sent a payout yesterday and it hasn't arrived. Can you check?").slice(0, 4000),
      })
    : { ok: false as const, error: "bad_request" };
  return Response.json(out, { status: out.ok ? 200 : 400 });
}
