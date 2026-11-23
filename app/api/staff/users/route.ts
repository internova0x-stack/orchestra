import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { currentStaff, PERMISSIONS, ROLE_NAME, can, type Permission } from "@/lib/auth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The signed-in member of the team (the screens' "who am I"), with their role and what it allows. `staff` keeps the
 * list shape the screens used for the simulated sign-in: it holds only the signed-in person.
 */
export async function GET(req: Request) {
  if (!process.env.DATABASE_URL) return Response.json({ staff: [] }, { status: 503 });
  const sql = db();
  await ensureSeeded(sql);
  const me = await currentStaff(sql, req);
  if (!me) return Response.json({ staff: [], me: null }, { status: 401 });
  const permissions = (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(me.role, p));
  return Response.json({ staff: [{ id: me.id, name: me.name, role: me.role }], me: { ...me, roleName: ROLE_NAME[me.role] }, permissions }, { headers: { "Cache-Control": "no-store" } });
}
