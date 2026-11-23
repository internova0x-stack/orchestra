import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db.ts";
import { extractFromPolicy } from "@/lib/policyExtract.ts";
import { staffUser } from "@/lib/staff.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TYPES = ["application/pdf", "text/plain", "text/markdown"];

/** Read an uploaded policy document into proposed rule changes, each waiting for a supervisor. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { staffId?: string; file?: { name?: string; media_type?: string; data?: string } } | null;
  const f = body?.file;
  if (!f || typeof f.data !== "string" || !TYPES.includes(f.media_type ?? "") || f.data.length > 4_300_000) {
    return Response.json({ ok: false, error: "Upload a PDF or a text file under 3 MB." }, { status: 400 });
  }
  if (!process.env.DATABASE_URL || !process.env.ANTHROPIC_API_KEY) return Response.json({ ok: false, error: "The database or the AI service isn't set up." }, { status: 503 });
  const sql = db();
  const staff = await staffUser(sql, body?.staffId);
  if (!staff) return Response.json({ ok: false, error: "Sign in at the top of the Rules screen first." }, { status: 403 });
  try {
    const out = await extractFromPolicy(sql, { name: String(f.name ?? "policy").slice(0, 120), media_type: f.media_type!, data: f.data }, staff);
    return Response.json({ ok: true, ...out });
  } catch (err) {
    console.error("policy extraction failed", err);
    const msg = err instanceof Anthropic.APIError ? `The AI service couldn't read it (${err.status}).` : "The document couldn't be read. Try a text-based PDF or a .txt file.";
    return Response.json({ ok: false, error: msg }, { status: 502 });
  }
}
