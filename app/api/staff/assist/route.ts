import { db } from "@/lib/db.ts";
import { runStaffTurn } from "@/lib/staffAgent.ts";
import type { StreamEvent } from "@/lib/tools.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Staff mode (use case 19): a signed-in staff member asks Alexis about one case. Streams like the chat. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { sessionId?: string; caseRef?: string; staffId?: string; message?: string } | null;
  if (!body?.sessionId || !/^[0-9a-f-]{36}$/i.test(body.sessionId) || !body.caseRef || !body.staffId || !body.message?.trim()) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if (!process.env.DATABASE_URL || !process.env.ANTHROPIC_API_KEY) return Response.json({ error: "not_configured" }, { status: 503 });
  const sql = db();
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: StreamEvent) => controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      try {
        await runStaffTurn(sql, { sessionId: body.sessionId!, caseRef: body.caseRef!.toUpperCase(), staffId: body.staffId!, message: body.message! }, emit);
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
