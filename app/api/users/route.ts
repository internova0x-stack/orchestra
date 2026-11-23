import { db } from "@/lib/db.ts";
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
  await ensureSeeded(sql);
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
  return Response.json({ users }, { headers: { "Cache-Control": "no-store" } });
}
