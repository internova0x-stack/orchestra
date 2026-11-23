import type { Sql } from "../db.ts";
import { checkApiKey } from "./keys.ts";

/** The calling system's key, or a 401 response to return. */
export async function requireKey(sql: Sql, req: Request): Promise<{ id: string; name: string } | Response> {
  // A helpdesk that can't set a header (some webhook tools) may send the key as ?key=orc_… instead.
  const q = new URL(req.url).searchParams.get("key");
  const key = await checkApiKey(sql, req.headers.get("authorization") ?? (q ? `Bearer ${q}` : null));
  return key ?? Response.json({ error: "unauthorized", message: "Send an Orchestra API key: Authorization: Bearer orc_…" }, { status: 401 });
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
