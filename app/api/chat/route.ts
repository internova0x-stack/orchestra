import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { runTurn } from "@/lib/agent.ts";
import type { StreamEvent } from "@/lib/tools.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f-]{36}$/i;

/** One customer turn. Streams newline-delimited JSON events while Alexis works. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    conversationId?: string;
    typingUserId?: string;
    message?: string;
    identity?: { full_name: string; date_of_birth: string; registration_number: string };
    confirm?: boolean;
  } | null;
  if (!body?.conversationId || !UUID.test(body.conversationId)) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if (!process.env.DATABASE_URL || !process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "not_configured", missing: [!process.env.DATABASE_URL && "DATABASE_URL", !process.env.ANTHROPIC_API_KEY && "ANTHROPIC_API_KEY"].filter(Boolean) }, { status: 503 });
  }
  const sql = db();
  await ensureSeeded(sql);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: StreamEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        await runTurn(
          sql,
          {
            conversationId: body.conversationId!,
            typingUserId: body.typingUserId ?? null,
            message: typeof body.message === "string" ? body.message.slice(0, 4000) : undefined,
            identity: body.identity,
            confirm: typeof body.confirm === "boolean" ? body.confirm : undefined,
          },
          emit,
        );
      } catch (err) {
        console.error(err);
        emit({ type: "error", message: "Something went wrong on my side and I couldn't complete that. Please try again in a moment." });
        emit({ type: "done" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
