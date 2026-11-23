import postgres from "postgres";

// One connection pool per server process. DATABASE_URL is Supabase's transaction pooler
// connection string (port 6543), which doesn't support prepared statements.
type Sql = ReturnType<typeof postgres>;

const g = globalThis as unknown as { __orchestraSql?: Sql };

export function db(): Sql {
  if (!g.__orchestraSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    g.__orchestraSql = postgres(url, {
      prepare: false,
      max: 5,
      idle_timeout: 20,
      onnotice: () => {},
    });
  }
  return g.__orchestraSql;
}

export type { Sql };
