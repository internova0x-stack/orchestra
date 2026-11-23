import { db } from "@/lib/db.ts";
import { customerView } from "@/lib/takeover.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The customer app's check while the chat is open: whether a member of the team is handling it, the
 * team's replies, and the team's decisions on the customer's cases. Nothing from the activity log.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!process.env.DATABASE_URL || !/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ takenOverBy: null, staff: [], updates: [] });
  return Response.json(await customerView(db(), id), { headers: { "Cache-Control": "no-store" } });
}
