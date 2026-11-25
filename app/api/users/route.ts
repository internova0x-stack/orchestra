import { db, dbProblem } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The customer picker: every sample business user, with the identity-check details a tester
 * types in (Test Plan, "How to run a test"). Simulated people only.
 */
export async function GET() {
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured", users: [] }, { status: 503 });
  const sql = db();
  try {
    await ensureSeeded(sql);
  } catch (e) {
    console.error("database setup failed", e);
    return Response.json({ error: "db", message: dbProblem(e), users: [] }, { status: 500 });
  }
  const rows = await sql<{ id: string; full_name: string; role: string; dob: string; business: string; reg: string | null; kind: string; account: string | null }[]>`
    select u.id, u.full_name, u.role, to_char(u.date_of_birth, 'YYYY-MM-DD') as dob, b.name as business,
      b.registration_number as reg, b.kind, b.account_number as account
    from business_users u join businesses b on b.id = u.business_id
    order by (b.kind = 'personal'), b.name, u.role desc, u.full_name`;
  const users = rows.map((r) => ({
    id: r.id,
    name: r.full_name,
    business: r.business,
    role: r.kind === "personal" ? "Personal" : r.role === "payment_rights" ? "Payment rights" : "View-only",
    dob: r.dob,
    registration: r.kind === "personal" ? `acct ending ${(r.account ?? "").replace(/\s/g, "").slice(-4)}` : `reg. ${r.reg}`,
  }));
  // People who paid a merchant at checkout (a payment company's customers' customers): no account, so the tester
  // plays them with what's on their receipt, which Alexis checks against the payment (check_payment_evidence).
  const paid = await sql<{ id: string; email: string | null; merchant: string; channel: string; amount: string; currency: string; on: string; card: string | null; account: string | null; session: string | null; status: string }[]>`
    select c.id, c.payer_email as email, b.name as merchant, c.channel, coalesce(c.amount_received, c.amount_expected)::text as amount, c.currency,
      to_char(c.created_at at time zone 'Africa/Lagos', 'YYYY-MM-DD') as on, c.payer_card_last4 as card, c.payer_account_last4 as account, c.session_id as session, c.status
    from checkout_payments c join businesses b on b.id = c.merchant_holder_id where c.status <> 'duplicate' order by c.id`.catch(() => []);
  const sessions = await sql<{ session_id: string }[]>`select session_id from nip_sessions`.catch(() => []);
  const nameOf = (email: string | null) => (email ?? "payer").split("@")[0].split(/[._]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  const SCENE: Record<string, string> = { successful: "Paid; says the merchant didn't get it", received_late: "Paid after the checkout expired", received_short: "Paid a little less than asked", received_over: "Paid too much", awaiting: "Says they paid; nothing arrived", failed_debited: "Card failed but was debited", unmatched: "Money not matched" };
  const payers = paid.map((p, i) => ({
    id: `payer:${p.id}`,
    name: nameOf(p.email),
    scene: p.id === "CK-90106" ? "Topped up a wallet; not credited" : p.id === "CK-90108" ? "Charged twice for one order" : p.id === "CK-90110" ? "Waiting for a card refund" : p.id === "CK-90111" ? "Paid; payment under review" : SCENE[p.status] ?? p.status,
    merchant: p.merchant,
    paid: `${p.currency === "NGN" ? "₦" : p.currency + " "}${Number(p.amount).toLocaleString("en-GB")} on ${p.on}`,
    details: [p.email && `email ${p.email}`, p.card && `card ending ${p.card}`, p.account && `sent from account ending ${p.account}`].filter(Boolean) as string[],
    // A payer whose transfer never arrived has the session ID on their own receipt.
    session: p.session ?? (p.status === "awaiting" ? (p.id === "CK-90104" ? sessions.find((x) => x.session_id.endsWith("004"))?.session_id : sessions.find((x) => x.session_id.endsWith("005"))?.session_id) ?? null : null),
    order: i,
  }));
  return Response.json({ users, payers }, { headers: { "Cache-Control": "no-store" } });
}
