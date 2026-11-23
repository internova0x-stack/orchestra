import type { Sql } from "../db.ts";
import { checkApiKey } from "./keys.ts";

/** The calling system's key, or a 401 response to return. */
export async function requireKey(sql: Sql, req: Request): Promise<{ id: string; name: string } | Response> {
  const key = await checkApiKey(sql, req.headers.get("authorization"));
  return key ?? Response.json({ error: "unauthorized", message: "Send an Orchestra API key: Authorization: Bearer orc_…" }, { status: 401 });
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
