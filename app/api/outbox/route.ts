import { db } from "@/lib/db.ts";
import { runUpdates } from "@/lib/updates.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Proactive updates (use case 17): runs the watches, then lists the messages sent to this sample
 * user's contact details on file. The simulated phone in the chat's side panel shows them.
 */
export async function GET(req: Request) {
  const user = new URL(req.url).searchParams.get("user") ?? "";
  if (!process.env.DATABASE_URL || !/^[a-z0-9-]{1,40}$/.test(user)) return Response.json({ messages: [] });
  const sql = db();
  await runUpdates(sql).catch((err) => console.error("updates", err));
  const messages = await sql`
    select o.id, o.channel, o.sent_to, o.body, o.sent_at from outbox o
    where o.user_id = ${user} order by o.sent_at desc limit 20`;
  return Response.json({ messages }, { headers: { "Cache-Control": "no-store" } });
}
