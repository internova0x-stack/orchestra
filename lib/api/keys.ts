import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Sql } from "../db.ts";

// API keys for systems that call the Orchestra API. Only a hash is stored; the key is shown once.
// Format: orc_<8-char id>_<secret>. The id finds the row; the hash is compared in constant time.

const hash = (key: string) => createHash("sha256").update(key).digest("hex");

export async function createApiKey(sql: Sql, name: string, createdBy: string): Promise<{ id: string; key: string; prefix: string }> {
  const id = randomBytes(6).toString("base64url").replace(/[-_]/g, "x").slice(0, 8);
  const key = `orc_${id}_${randomBytes(24).toString("base64url")}`;
  const prefix = `orc_${id}_…`;
  await sql`insert into api_keys (id, name, prefix, hash, created_by) values (${id}, ${name.trim().slice(0, 80) || "Unnamed"}, ${prefix}, ${hash(key)}, ${createdBy})`;
  return { id, key, prefix };
}

export async function revokeApiKey(sql: Sql, id: string): Promise<boolean> {
  const r = await sql`update api_keys set revoked_at = now() where id = ${id} and revoked_at is null returning id`;
  return r.length > 0;
}

/** The key's id if the Authorization header carries a live key, else null. */
export async function checkApiKey(sql: Sql, header: string | null): Promise<{ id: string; name: string } | null> {
  const key = header?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const m = key.match(/^orc_([A-Za-z0-9]{8})_[A-Za-z0-9_-]{20,}$/);
  if (!m) return null;
  const [row] = await sql<{ id: string; name: string; hash: string }[]>`select id, name, hash from api_keys where id = ${m[1]} and revoked_at is null`;
  if (!row) return null;
  const a = Buffer.from(hash(key), "hex"), b = Buffer.from(row.hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  await sql`update api_keys set last_used_at = now() where id = ${row.id}`.catch(() => {});
  return { id: row.id, name: row.name };
}
