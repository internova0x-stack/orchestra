import postgres from "postgres";

// One connection pool per server process. DATABASE_URL is Supabase's transaction pooler
// connection string (port 6543), which doesn't support prepared statements.
type Sql = ReturnType<typeof postgres>;

const g = globalThis as unknown as { __orchestraSql?: Sql };

export function db(): Sql {
  if (!g.__orchestraSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    // Supabase needs an encrypted connection; a local test database doesn't have one.
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || /[?&]sslmode=disable/.test(url);
    g.__orchestraSql = postgres(url, {
      prepare: false,
      max: 5,
      idle_timeout: 20,
      connect_timeout: 15,
      ssl: local ? false : "require",
      onnotice: () => {},
    });
  }
  return g.__orchestraSql;
}

export type { Sql };

/**
 * A plain-language reason the database can't be used, for the first screen a tester sees.
 * Never includes the password or the full connection string.
 */
export function dbProblem(e: unknown): string {
  const url = process.env.DATABASE_URL ?? "";
  let host = "";
  let facts = "";

  try {
    const u = new URL(url);
    host = u.hostname;
    // Only what helps compare with Supabase's screens: never the password itself.
    const pw = decodeURIComponent(u.password);
    const ref = u.username.includes(".") ? u.username.split(".").slice(1).join(".") : "(none: the user should be postgres.<project ID>)";
    const odd = /[^A-Za-z0-9]/.test(pw) ? ", and it contains symbols or spaces" : "";
    facts = ` What Vercel has: project ID ${ref}, port ${u.port || "(none)"}, a password of ${pw.length} characters${odd}.`;

  } catch {
    return "DATABASE_URL in Vercel isn't a valid connection string. If the password has symbols like @, # or /, reset it in Supabase to letters and numbers only, then paste the string again.";
  }
  if (/\[?YOUR-PASSWORD\]?/i.test(url)) return "DATABASE_URL still contains [YOUR-PASSWORD]: replace it (brackets included) with the database password.";
  if (/^db\..+\.supabase\.co$/.test(host)) return "DATABASE_URL is Supabase's direct connection, which Vercel can't reach. Use the Transaction pooler string instead (port 6543).";
  const err = e as { code?: string; message?: string };
  const msg = String(err?.message ?? e);
  if (err?.code === "28P01" || /password authentication failed/i.test(msg)) return `Supabase refused the password in DATABASE_URL.${facts} Check the project ID matches Supabase's Project Settings, and the password length matches the one you set.`;
  if (/tenant or user not found/i.test(msg)) return `Supabase doesn't recognise the user in DATABASE_URL.${facts} Copy the Transaction pooler string again.`;
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) return `The database address (${host}) can't be found. Copy the Transaction pooler string from Supabase's Connect button again.`;
  if (/ETIMEDOUT|timeout|ECONNREFUSED|ENETUNREACH/i.test(msg)) return `The database (${host}) didn't answer. Check the Supabase project isn't paused, and that the string is the Transaction pooler one (port 6543).`;
  return `The database returned an error: ${msg.replace(url, "[DATABASE_URL]").slice(0, 200)}`;
}
