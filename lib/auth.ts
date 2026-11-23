import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Sql } from "./db.ts";

// Console sign-in and roles (Tomi, Nov 23: "build the roles and log in"). Each member of the bank's team has their
// own account (email and password) and one role; what they can see and do follows the role, checked on the server
// for every request (the screens only hide what the role can't use). The customer app and the integration APIs
// (API keys) don't use these accounts.
// Passwords: scrypt with a random salt, never stored or logged in clear. Sessions: a random token in an httpOnly
// cookie, stored only as a hash, ending after 12 hours idle or 7 days. Five wrong passwords for an email in 15
// minutes pause that email's sign-in. Every sign-in, failure and account change is in the activity log.

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const ROLES = ["support_agent", "supervisor", "operations_admin", "compliance", "management", "it_admin"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_NAME: Record<Role, string> = {
  support_agent: "Support agent", supervisor: "Supervisor", operations_admin: "Operations admin",
  compliance: "Compliance (read-only)", management: "Management (read-only)", it_admin: "IT admin",
};
export const ROLE_ABOUT: Record<Role, string> = {
  support_agent: "Works conversations and cases: takes over, replies, takes account actions within the agent limit, proposes rule changes.",
  supervisor: "Everything an agent does, plus approvals: recalls over the cap, large staff actions, bank freezes, rule changes.",
  operations_admin: "Runs the console: rules go live, Alexis on or off, routing, plan and usage, team accounts, connectors and keys.",
  compliance: "Reads everything (conversations, activity log, cases, rule history) and changes nothing.",
  management: "Reads the dashboard and plan and usage.",
  it_admin: "Connects systems: API keys, webhooks, CRM connectors, team accounts.",
};

/** What each role may do. The server checks these on every request. */
export const PERMISSIONS = {
  inbox_view: ["support_agent", "supervisor", "operations_admin", "compliance"],
  conversation_act: ["support_agent", "supervisor"],
  staff_queue_view: ["support_agent", "supervisor", "operations_admin", "compliance"],
  case_work: ["support_agent", "supervisor"],
  case_approve: ["supervisor"],
  rules_view: ["support_agent", "supervisor", "operations_admin", "compliance", "management", "it_admin"],
  rules_propose: ["support_agent", "supervisor", "operations_admin"],
  rules_approve: ["supervisor", "operations_admin"],
  dashboard_view: ["supervisor", "operations_admin", "compliance", "management"],
  billing_view: ["operations_admin", "management"],
  api_view: ["supervisor", "operations_admin", "it_admin", "compliance"],
  api_manage: ["operations_admin", "it_admin"],
  team_manage: ["operations_admin", "it_admin"],
  demo_reset: ["supervisor", "operations_admin"],
} satisfies Record<string, Role[]>;
export type Permission = keyof typeof PERMISSIONS;
export const can = (role: Role, p: Permission) => (PERMISSIONS[p] as readonly Role[]).includes(role);

export interface Staff { id: string; name: string; email: string | null; role: Role; must_change: boolean }

export const SESSION_COOKIE = "orc_session";
const IDLE_MS = 12 * 3_600_000;
const MAX_MS = 7 * 86_400_000;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 32);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function checkPassword(pw: string, stored: string | null): Promise<boolean> {
  const [alg, salt, key] = (stored ?? "").split("$");
  if (alg !== "scrypt" || !salt || !key) return false;
  const got = await scrypt(pw, Buffer.from(salt, "hex"), 32);
  const want = Buffer.from(key, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== "string" || pw.length < 10) return "Use at least 10 characters.";
  if (pw.length > 200) return "Use at most 200 characters.";
  if (!/[a-z]/i.test(pw) || !/\d/.test(pw)) return "Use letters and at least one number.";
  return null;
}

const cleanEmail = (e: unknown) => (typeof e === "string" ? e.trim().toLowerCase().slice(0, 200) : "");
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

async function log(sql: Sql, staff: string | null, summary: string, kind: "identity" | "refusal" | "rule_edit" = "identity") {
  await sql`insert into audit_log (kind, tool, summary, staff) values (${kind}, 'console_account', ${summary}, ${staff})`;
}

/** True until the first account with a password exists: the sign-in page then offers to create it. */
export async function needsSetup(sql: Sql): Promise<boolean> {
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from staff_users where password_hash is not null and active`;
  return r.n === 0;
}

/** The first account, an operations admin. Only while no account has a password. */
export async function setupFirstAdmin(sql: Sql, input: { name?: unknown; email?: unknown; password?: unknown }) {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 80) : "";
  const email = cleanEmail(input.email);
  if (!name || !emailOk(email)) return { ok: false as const, error: "Give your name and a valid email." };
  const bad = passwordProblem(input.password);
  if (bad) return { ok: false as const, error: bad };
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(4219)`;
    const [r] = await tx<{ n: number }[]>`select count(*)::int as n from staff_users where password_hash is not null and active`;
    if (r.n > 0) return { ok: false as const, error: "The console is already set up. Sign in instead." };
    const hash = await hashPassword(input.password as string);
    const [taken] = await tx`select id from staff_users where email = ${email}`;
    const id = taken ? String(taken.id) : `u-${randomBytes(4).toString("hex")}`;
    if (taken) await tx`update staff_users set name = ${name}, role = 'operations_admin', password_hash = ${hash}, active = true, must_change = false where id = ${id}`;
    else await tx`insert into staff_users (id, name, email, role, password_hash) values (${id}, ${name}, ${email}, 'operations_admin', ${hash})`;
    await tx`insert into audit_log (kind, tool, summary, staff) values ('rule_edit', 'console_account', ${`console set up · first operations admin ${name}`}, ${name})`;
    return { ok: true as const, id };
  });
}

/** Sign in: a session token to set as the cookie, or a reason that never says whether the email exists. */
export async function signIn(sql: Sql, emailRaw: unknown, password: unknown, ua: string | null) {
  const email = cleanEmail(emailRaw);
  const generic = { ok: false as const, error: "That email and password don't match an account." };
  if (!email || typeof password !== "string") return generic;
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from login_attempts where email = ${email} and not ok and at > now() - interval '15 minutes'`;
  if (n >= 5) return { ok: false as const, error: "Too many attempts. Wait 15 minutes, or ask an admin to reset your password." };
  const [u] = await sql<{ id: string; name: string; password_hash: string | null; active: boolean }[]>`select id, name, password_hash, active from staff_users where email = ${email}`;
  const ok = Boolean(u?.active) && (await checkPassword(password, u?.password_hash ?? null));
  await sql`insert into login_attempts (email, ok) values (${email}, ${ok})`;
  if (!ok) {
    await log(sql, null, `console sign-in failed · ${email.replace(/^(.).*(@.*)$/, "$1•••$2")}`, "refusal");
    return generic;
  }
  const token = randomBytes(32).toString("base64url");
  await sql`insert into staff_sessions (token_hash, staff_id, user_agent, expires_at) values (${sha(token)}, ${u.id}, ${(ua ?? "").slice(0, 200)}, ${new Date(Date.now() + MAX_MS)})`;
  await sql`update staff_users set last_login_at = now() where id = ${u.id}`;
  await log(sql, u.name, `${u.name} signed in to the console`);
  return { ok: true as const, token };
}

export async function signOut(sql: Sql, token: string | null) {
  if (token) await sql`delete from staff_sessions where token_hash = ${sha(token)}`;
}

const tokenFrom = (req: Request) => {
  const raw = req.headers.get("cookie") ?? "";
  const m = raw.split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  return m ? decodeURIComponent(m.slice(SESSION_COOKIE.length + 1)) : null;
};
export { tokenFrom };

/** The signed-in member of the team, or null. Sessions end after 12 hours idle or 7 days. */
export async function currentStaff(sql: Sql, req: Request): Promise<Staff | null> {
  const token = tokenFrom(req);
  if (!token) return null;
  const [s] = await sql<(Staff & { last_seen: Date; expires_at: Date; active: boolean })[]>`
    select u.id, u.name, u.email, u.role, u.must_change, u.active, s.last_seen, s.expires_at
    from staff_sessions s join staff_users u on u.id = s.staff_id where s.token_hash = ${sha(token)}`;
  if (!s || !s.active || new Date(s.expires_at) < new Date() || Date.now() - new Date(s.last_seen).getTime() > IDLE_MS) return null;
  if (Date.now() - new Date(s.last_seen).getTime() > 60_000) await sql`update staff_sessions set last_seen = now() where token_hash = ${sha(token)}`;
  return { id: s.id, name: s.name, email: s.email, role: s.role, must_change: s.must_change };
}

/**
 * The signed-in member of the team if their role allows this, or the response to send. Changes must come from this
 * site (the Origin header), so another site can't make a signed-in browser act.
 */
export async function requirePermission(sql: Sql, req: Request, p: Permission): Promise<Staff | Response> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.get("origin");
    if (origin && origin !== new URL(req.url).origin) return Response.json({ ok: false, error: "forbidden", message: "Requests must come from the console." }, { status: 403 });
  }
  const s = await currentStaff(sql, req);
  if (!s) return Response.json({ ok: false, error: "sign_in", message: "Sign in to the console first." }, { status: 401 });
  if (s.must_change && p !== "rules_view") return Response.json({ ok: false, error: "change_password", message: "Choose a new password first (your account page)." }, { status: 403 });
  if (!can(s.role, p)) return Response.json({ ok: false, error: "not_allowed", message: `Your role (${ROLE_NAME[s.role]}) doesn't include this.` }, { status: 403 });
  return s;
}

export async function changeOwnPassword(sql: Sql, staff: Staff, current: unknown, next: unknown) {
  const [u] = await sql<{ password_hash: string | null }[]>`select password_hash from staff_users where id = ${staff.id}`;
  if (typeof current !== "string" || !(await checkPassword(current, u?.password_hash ?? null))) return { ok: false as const, error: "Your current password isn't right." };
  const bad = passwordProblem(next);
  if (bad) return { ok: false as const, error: bad };
  if (next === current) return { ok: false as const, error: "Choose a different password." };
  await sql`update staff_users set password_hash = ${await hashPassword(next as string)}, must_change = false where id = ${staff.id}`;
  await log(sql, staff.name, `${staff.name} changed their password`);
  return { ok: true as const };
}

// ---------------------------------------------------------------- team accounts (operations or IT admins)

export async function listTeam(sql: Sql) {
  return sql<{ id: string; name: string; email: string | null; role: Role; active: boolean; has_password: boolean; must_change: boolean; last_login_at: string | null }[]>`
    select id, name, email, role, active, password_hash is not null as has_password, must_change, last_login_at from staff_users order by active desc, name`;
}

const tempPassword = () => `${randomBytes(9).toString("base64url")}7`;

/** A new account with a temporary password, shown once to the admin; the person chooses their own at first sign-in. */
export async function addMember(sql: Sql, by: Staff, input: { name?: unknown; email?: unknown; role?: unknown }) {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 80) : "";
  const email = cleanEmail(input.email);
  if (!name || !emailOk(email)) return { ok: false as const, error: "Give a name and a valid email." };
  if (!ROLES.includes(input.role as Role)) return { ok: false as const, error: "Choose a role." };
  const [taken] = await sql`select 1 from staff_users where email = ${email}`;
  if (taken) return { ok: false as const, error: "Someone already has that email." };
  const temp = tempPassword();
  const id = `u-${randomBytes(4).toString("hex")}`;
  await sql`insert into staff_users (id, name, email, role, password_hash, must_change) values (${id}, ${name}, ${email}, ${input.role as Role}, ${await hashPassword(temp)}, true)`;
  await log(sql, by.name, `account added · ${name} · ${ROLE_NAME[input.role as Role]}`, "rule_edit");
  return { ok: true as const, id, tempPassword: temp };
}

export async function updateMember(sql: Sql, by: Staff, id: string, input: { role?: unknown; active?: unknown; reset?: unknown }) {
  const [u] = await sql<{ id: string; name: string; role: Role; active: boolean }[]>`select id, name, role, active from staff_users where id = ${id}`;
  if (!u) return { ok: false as const, error: "No such account." };
  if (u.id === by.id && (input.active === false || (input.role !== undefined && input.role !== u.role))) return { ok: false as const, error: "You can't change your own role or switch yourself off. Ask another admin." };
  if (input.role !== undefined) {
    if (!ROLES.includes(input.role as Role)) return { ok: false as const, error: "Choose a role." };
    await sql`update staff_users set role = ${input.role as Role} where id = ${id}`;
    await log(sql, by.name, `role changed · ${u.name} · ${ROLE_NAME[u.role]} → ${ROLE_NAME[input.role as Role]}`, "rule_edit");
  }
  if (typeof input.active === "boolean") {
    await sql`update staff_users set active = ${input.active} where id = ${id}`;
    if (!input.active) await sql`delete from staff_sessions where staff_id = ${id}`;
    await log(sql, by.name, `account ${input.active ? "switched on" : "switched off"} · ${u.name}`, "rule_edit");
  }
  if (input.reset === true) {
    const temp = tempPassword();
    await sql`update staff_users set password_hash = ${await hashPassword(temp)}, must_change = true where id = ${id}`;
    await sql`delete from staff_sessions where staff_id = ${id}`;
    await log(sql, by.name, `password reset · ${u.name}`, "rule_edit");
    return { ok: true as const, tempPassword: temp };
  }
  // The console must always keep someone who can manage accounts.
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from staff_users where active and role in ('operations_admin','it_admin') and password_hash is not null`;
  if (n === 0) {
    await sql`update staff_users set role = ${u.role}, active = ${u.active} where id = ${id}`;
    return { ok: false as const, error: "At least one active operations or IT admin must remain." };
  }
  return { ok: true as const };
}

/** For a demo: give the sample team (invented people) one shared password so each role can be tried. */
export async function enableDemoTeam(sql: Sql, by: Staff, password: unknown) {
  const bad = passwordProblem(password);
  if (bad) return { ok: false as const, error: bad };
  const hash = await hashPassword(password as string);
  const rows = await sql`update staff_users set password_hash = ${hash}, must_change = false, active = true where demo returning name`;
  await log(sql, by.name, `demo team signed-in enabled · ${rows.length} sample accounts`, "rule_edit");
  return { ok: true as const, count: rows.length };
}
