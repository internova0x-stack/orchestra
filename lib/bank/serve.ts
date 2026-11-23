import type { BankConnector } from "./contract.ts";

// The Bank Connector API served over HTTP: the reference implementation, backed by the simulated bank.
// Routes (all under /api/bank/v1, Authorization: Bearer <BANK_API_KEY>):
//   POST /identity/verify                       GET /users/{userId}
//   GET  /holders/{id}/transfers                GET /holders/{id}/incoming-payments
//   GET  /holders/{id}/verification             GET /holders/{id}/balances
//   GET  /holders/{id}/fees                     GET /holders/{id}/restrictions
//   POST /holders/{id}/recalls (Idempotency-Key)

type Reply = { status: number; body: unknown };
const notFound: Reply = { status: 404, body: { error: "not_found" } };
const num = (v: string | null) => (v == null || v === "" || !Number.isFinite(Number(v)) ? undefined : Number(v));
const str = (v: string | null) => (v == null || v === "" ? undefined : v.slice(0, 200));

export async function serveBank(b: BankConnector, method: string, path: string[], query: URLSearchParams, body: unknown, idempotencyKey: string | null): Promise<Reply> {
  const [a, id, sub] = path;
  if (method === "POST" && a === "identity" && id === "verify" && path.length === 2) {
    const c = body as { full_name?: unknown; date_of_birth?: unknown; registration_number?: unknown } | null;
    if (!c || typeof c.full_name !== "string" || typeof c.date_of_birth !== "string" || typeof c.registration_number !== "string") return { status: 400, body: { error: "bad_request" } };
    return { status: 200, body: await b.verifyIdentity({ full_name: c.full_name, date_of_birth: c.date_of_birth, registration_number: c.registration_number }) };
  }
  if (method === "GET" && a === "users" && id && path.length === 2) {
    const u = await b.getUser(id);
    return u ? { status: 200, body: u } : notFound;
  }
  if (a !== "holders" || !id || path.length !== 3) return notFound;
  if (method === "GET") {
    switch (sub) {
      case "transfers": return { status: 200, body: { data: await b.searchTransfers(id, { reference: str(query.get("reference")), recipient: str(query.get("recipient")), amount: num(query.get("amount")) }) } };
      case "incoming-payments": return { status: 200, body: { data: await b.searchIncomingPayments(id, { amount: num(query.get("amount")), currency: str(query.get("currency")) }) } };
      case "verification": { const v = await b.getVerification(id); return v ? { status: 200, body: v } : notFound; }
      case "balances": return { status: 200, body: { data: await b.getBalances(id) } };
      case "fees": {
        const kind = query.get("kind");
        return { status: 200, body: { data: await b.listFees(id, { kind: kind === "fee" || kind === "conversion" ? kind : undefined, transfer: str(query.get("transfer")), since: str(query.get("since")) }) } };
      }
      case "restrictions": return { status: 200, body: { data: await b.listRestrictions(id, { transfer: str(query.get("transfer")) }) } };
    }
  }
  if (method === "POST" && sub === "recalls") {
    const r = body as { transfer_id?: unknown; amount?: unknown; currency?: unknown; reference?: unknown; requested_by?: unknown; approved_by?: unknown } | null;
    if (!idempotencyKey) return { status: 400, body: { error: "idempotency_key_required" } };
    if (!r || typeof r.transfer_id !== "string" || typeof r.amount !== "string" || typeof r.currency !== "string" || typeof r.reference !== "string" || typeof r.requested_by !== "string") {
      return { status: 400, body: { error: "bad_request" } };
    }
    return { status: 200, body: await b.requestRecall(id, { transfer_id: r.transfer_id, amount: r.amount, currency: r.currency, reference: r.reference, requested_by: r.requested_by, approved_by: typeof r.approved_by === "string" ? r.approved_by : null }, idempotencyKey) };
  }
  return notFound;
}
