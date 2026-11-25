import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { runTurn } from "@/lib/agent.ts";
import type { StreamEvent } from "@/lib/tools.ts";
import { isWidgetConversation, liveWidget } from "@/lib/widget.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const imageOk = (i: unknown) => {
  const img = i as { media_type?: unknown; data?: unknown } | undefined;
  return Boolean(img && typeof img.media_type === "string" && IMAGE_TYPES.includes(img.media_type) && typeof img.data === "string" && img.data.length < 4_700_000 && /^[A-Za-z0-9+/=]+$/.test(img.data.slice(0, 200)));
};

/** One customer turn from the website chat, streamed as newline-delimited JSON (as the customer app's). */
export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const body = (await req.json().catch(() => null)) as {
    conversationId?: string; message?: string; confirm?: boolean; code?: string;
    identity?: { full_name: string; date_of_birth: string; registration_number: string };
    image?: { media_type: string; data: string };
  } | null;
  if (!process.env.DATABASE_URL || !process.env.ANTHROPIC_API_KEY) return Response.json({ error: "not_configured" }, { status: 503 });
  const sql = db();
  await ensureSeeded(sql);
  // Only a conversation this widget started, while the widget is live: nobody can write into another one.
  if (!body?.conversationId || !(await liveWidget(sql, key)) || !(await isWidgetConversation(sql, body.conversationId))) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const identity = body.identity && typeof body.identity === "object"
    ? { full_name: String(body.identity.full_name ?? "").slice(0, 200), date_of_birth: String(body.identity.date_of_birth ?? "").slice(0, 20), registration_number: String(body.identity.registration_number ?? "").slice(0, 60) }
    : undefined;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: StreamEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        await runTurn(sql, {
          conversationId: body.conversationId!,
          typingUserId: null,
          message: typeof body.message === "string" ? body.message.slice(0, 4000) : undefined,
          identity,
          confirm: typeof body.confirm === "boolean" ? body.confirm : undefined,
          code: typeof body.code === "string" ? body.code.slice(0, 12) : undefined,
          image: imageOk(body.image) ? (body.image as { media_type: "image/jpeg"; data: string }) : undefined,
          channel: "app",
        }, emit);
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
