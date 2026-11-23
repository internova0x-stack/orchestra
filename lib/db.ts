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
