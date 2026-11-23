import { db } from "@/lib/db.ts";
import { signOut, tokenFrom } from "@/lib/auth.ts";
import { clearCookie } from "@/lib/authCookie.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (process.env.DATABASE_URL) await signOut(db(), tokenFrom(req));
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearCookie(req) } });
}
