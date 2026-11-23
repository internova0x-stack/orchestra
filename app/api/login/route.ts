import { PASS_COOKIE, passToken } from "@/lib/sitePassword";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Check the shared password and remember this device for 30 days. */
export async function POST(req: Request) {
  const password = process.env.SITE_PASSWORD;
  const body = (await req.json().catch(() => null)) as { password?: string } | null;
  if (!password) return Response.json({ ok: true });
  // A short pause on every attempt makes guessing slow.
  await new Promise((r) => setTimeout(r, 600));
  if (typeof body?.password !== "string" || body.password !== password) {
    return Response.json({ ok: false, error: "That password isn't right." }, { status: 401 });
  }
  const res = Response.json({ ok: true });
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  res.headers.append("Set-Cookie", `${PASS_COOKIE}=${await passToken(password)}; Path=/; Max-Age=${30 * 86400}; HttpOnly; SameSite=Lax${secure}`);
  return res;
}
