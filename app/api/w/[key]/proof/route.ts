import { db } from "@/lib/db.ts";
import { proofPdf } from "@/lib/proofPdf.ts";
import type { ProofDoc } from "@/lib/tools.ts";
import { isWidgetConversation, liveWidget } from "@/lib/widget.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A payment confirmation from a widget conversation, only for a customer verified as a user of the same business. */
export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const url = new URL(req.url);
  const ref = (url.searchParams.get("ref") ?? "").toUpperCase();
  const conversation = url.searchParams.get("conversation") ?? "";
  if (!/^PP-\d+$/.test(ref) || !/^[0-9a-f-]{36}$/i.test(conversation)) return new Response("Not found", { status: 404 });
  if (!process.env.DATABASE_URL) return new Response("Not configured", { status: 503 });
  const sql = db();
  if (!(await liveWidget(sql, key)) || !(await isWidgetConversation(sql, conversation))) return new Response("Not found", { status: 404 });
  const rows = await sql<{ details: ProofDoc }[]>`
    select p.details from proofs p
    join conversations c on c.id = ${conversation}
    join business_users u on u.id = c.verified_user_id
    where p.reference = ${ref} and p.business_id = u.business_id`;
  if (!rows[0]) return new Response("Not found", { status: 404 });
  const bytes = await proofPdf(rows[0].details);
  return new Response(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="payment-confirmation-${ref}.pdf"`, "Cache-Control": "no-store" },
  });
}
