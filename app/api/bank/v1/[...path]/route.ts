import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { simulatedBank } from "@/lib/bank/simulated.ts";
import { serveBank } from "@/lib/bank/serve.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The reference implementation of the Bank Connector API, backed by the simulated bank. It needs
// BANK_API_KEY set (the same key Orchestra sends); without it the endpoint is off.

function authorised(req: Request): boolean {
  const key = process.env.BANK_API_KEY?.trim();
  const sent = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!key || !sent) return false;
  const a = Buffer.from(sent), b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (!process.env.BANK_API_KEY) return Response.json({ error: "off", message: "The reference Bank API is off. Set BANK_API_KEY to turn it on." }, { status: 503 });
  if (!authorised(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured" }, { status: 503 });
  const { path } = await params;
  const sql = db();
  await ensureSeeded(sql);
  const body = req.method === "POST" ? await req.json().catch(() => null) : null;
  const out = await serveBank(simulatedBank(sql), req.method, path, new URL(req.url).searchParams, body, req.headers.get("idempotency-key"));
  return Response.json(out.body, { status: out.status, headers: { "Cache-Control": "no-store" } });
}

export { handle as GET, handle as POST };
