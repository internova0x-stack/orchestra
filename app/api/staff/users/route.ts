import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The staff sign-in list (simulated): a support agent and a supervisor. */
export async function GET() {
  if (!process.env.DATABASE_URL) return Response.json({ staff: [] }, { status: 503 });
  const sql = db();
  await ensureSeeded(sql);
  const staff = await sql`select id, name, role from staff_users order by role desc, name`;
  return Response.json({ staff });
}
