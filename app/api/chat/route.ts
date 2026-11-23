import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { runTurn } from "@/lib/agent.ts";
import type { StreamEvent } from "@/lib/tools.ts";
import { CHANNELS, type Channel } from "@/lib/session.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f-]{36}$/i;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** A screenshot: one of the image types Claude reads, base64, under about 3.5 MB. */
function imageOk(i: unknown): boolean {
  const img = i as { media_type?: unknown; data?: unknown } | undefined;
  return Boolean(img && typeof img.media_type === "string" && IMAGE_TYPES.includes(img.media_type) && typeof img.data === "string" && img.data.length < 4_700_000 && /^[A-Za-z0-9+/=]+$/.test(img.data.slice(0, 200)));
}

/** One customer turn. Streams newline-delimited JSON events while Alexis works. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    conversationId?: string;
    typingUserId?: string;
    message?: string;
    identity?: { full_name: string; date_of_birth: string; registration_number: string };
    confirm?: boolean;
    code?: string;
    image?: { media_type: string; data: string };
    channel?: string;
    subject?: string;
    language?: string;
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
            code: typeof body.code === "string" ? body.code.slice(0, 12) : undefined,
            image: imageOk(body.image) ? (body.image as { media_type: "image/jpeg"; data: string }) : undefined,
            channel: CHANNELS.includes(body.channel as Channel) ? (body.channel as Channel) : "app",
            subject: typeof body.subject === "string" ? body.subject.slice(0, 200) : undefined,
            language: typeof body.language === "string" ? body.language.slice(0, 8) : undefined,
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
