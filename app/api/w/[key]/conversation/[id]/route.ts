import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { customerView } from "@/lib/takeover.ts";
import { operations } from "@/lib/agent.ts";
import { isWidgetConversation, liveWidget } from "@/lib/widget.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * While the widget is open: the team's side (who's handling it, replies, decisions), the service notice, and with
 * ?history=1 the chat so far (to pick it up again on the bank's next page). Never the activity log.
 */
export async function GET(req: Request, { params }: { params: Promise<{ key: string; id: string }> }) {
  const { key, id } = await params;
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured" }, { status: 503 });
  const sql = db();
  await ensureSeeded(sql);
  if (!(await liveWidget(sql, key)) || !(await isWidgetConversation(sql, id))) return Response.json({ error: "not_found" }, { status: 404 });
  const [view, status] = await Promise.all([customerView(sql, id), operations(sql)]);
  let history: Line[] | undefined;
  if (new URL(req.url).searchParams.get("history") === "1") {
    const [c] = await sql<{ messages: Stored[]; last_activity: string }[]>`select messages, last_activity from conversations where id = ${id}`;
    // Picked up again only within half an hour; after that the visitor starts a new conversation.
    if (!c || Date.now() - new Date(c.last_activity).getTime() > 30 * 60_000) return Response.json({ error: "expired" }, { status: 410 });
    history = linesOf(c.messages);
  }
  return Response.json({ ...view, status, history }, { headers: { "Cache-Control": "no-store" } });
}

type Stored = { role: string; content: string | { type: string; text?: string; staff?: string }[] };
type Line = { role: "customer" | "alexis"; text: string; staff?: string; key?: string };

/** The chat as the customer saw it, in order. The team's replies keep the key customerView gives them. */
function linesOf(messages: Stored[] | null): Line[] {
  const out: Line[] = [];
  (messages ?? []).forEach((m, i) => {
    if (m.role === "system") return; // session notes for Alexis, never shown
    const role = m.role === "user" ? "customer" : "alexis";
    const add = (text: string) => {
      const last = out[out.length - 1];
      if (last && last.role === role && !last.staff) last.text += `\n\n${text}`;
      else out.push({ role, text });
    };
    if (typeof m.content === "string") { if (m.content.trim()) add(m.content); return; }
    m.content.forEach((b, j) => {
      const text = b.type === "text" && b.text?.trim() ? b.text : b.type === "image" ? "[Screenshot attached]" : "";
      if (!text) return;
      if (b.staff && role === "alexis") out.push({ role, text, staff: b.staff, key: `${i}-${j}` });
      else add(text);
    });
  });
  return out;
}
