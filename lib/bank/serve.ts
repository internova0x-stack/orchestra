import type { BankConnector } from "./contract.ts";

// The Bank Connector API served over HTTP: the reference implementation, backed by the simulated bank.
// Routes (all under /api/bank/v1, Authorization: Bearer <BANK_API_KEY>):
//   POST /identity/verify                       GET /users/{userId}
//   GET  /holders/{id}/transfers                GET /holders/{id}/incoming-payments
//   GET  /holders/{id}/verification             GET /holders/{id}/balances
//   GET  /holders/{id}/fees                     GET /holders/{id}/restrictions
//   POST /holders/{id}/recalls (Idempotency-Key)
//   GET  /users/{userId}/contact                POST /users/{userId}/unlock
//   GET  /holders/{id}/cards                    POST /holders/{id}/cards/{cardId}/freeze | /replace
//   GET  /holders/{id}/card-transactions        GET  /holders/{id}/payments
//   GET  /holders/{id}/payments/{paymentId}     GET  /holders/{id}/payments/{paymentId}/events
//   GET  /holders/{id}/loans                    GET  /holders/{id}/merchant-payouts
//   GET  /holders/{id}/merchant-holds           GET  /holders/{id}/bill-payments
//   POST /holders/{id}/bill-payments/{billId}/refund
//   GET  /holders/{id}/ussd-sessions            POST /holders/{id}/fees/{feeId}/refund
// Every POST needs an Idempotency-Key header.

type Reply = { status: number; body: unknown };
const notFound: Reply = { status: 404, body: { error: "not_found" } };
const num = (v: string | null) => (v == null || v === "" || !Number.isFinite(Number(v)) ? undefined : Number(v));
const str = (v: string | null) => (v == null || v === "" ? undefined : v.slice(0, 200));

const TX_STATUSES = ["pending", "settled", "declined", "reversed"] as const;

/** The body of an action request: Orchestra's reference and who asked. */
function actionBody(body: unknown) {
  const r = body as { reference?: unknown; requested_by?: unknown; reason?: unknown } | null;
  if (!r || typeof r.reference !== "string" || typeof r.requested_by !== "string") return null;
  return { reference: r.reference.slice(0, 80), requested_by: r.requested_by.slice(0, 80), reason: typeof r.reason === "string" ? r.reason.slice(0, 200) : null };
}

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
  if (method === "GET" && a === "users" && id && sub === "contact" && path.length === 3) {
    const c = await b.getContact(id);
    return c ? { status: 200, body: c } : notFound;
  }
  if (method === "POST" && a === "users" && id && sub === "unlock" && path.length === 3) {
    if (!idempotencyKey) return { status: 400, body: { error: "idempotency_key_required" } };
    const req = actionBody(body);
    return req ? { status: 200, body: await b.unlockLogin(id, req, idempotencyKey) } : { status: 400, body: { error: "bad_request" } };
  }
  if (a !== "holders" || !id) return notFound;

  // Records and actions one level down: /holders/{id}/{collection}/{recordId}[/{verb}]
  if (path.length >= 4) {
    const [, , , rec, verb] = path;
    if (path.length > 5) return notFound;
    if (method === "GET" && sub === "payments" && path.length === 4) return { status: 200, body: await b.getPayment(id, rec) };
    if (method === "GET" && sub === "payments" && verb === "events") return { status: 200, body: { data: await b.getPaymentEvents(id, rec) } };
    if (method === "POST" && path.length === 5) {
      if (!idempotencyKey) return { status: 400, body: { error: "idempotency_key_required" } };
      const req = actionBody(body);
      if (!req) return { status: 400, body: { error: "bad_request" } };
      if (sub === "cards" && verb === "freeze") return { status: 200, body: await b.freezeCard(id, rec, req, idempotencyKey) };
      if (sub === "cards" && verb === "replace") return { status: 200, body: await b.replaceCard(id, rec, req, idempotencyKey) };
      if (sub === "bill-payments" && verb === "refund") return { status: 200, body: await b.refundBillPayment(id, rec, req, idempotencyKey) };
      if (sub === "fees" && verb === "refund") return { status: 200, body: await b.refundFee(id, rec, req, idempotencyKey) };
    }
    return notFound;
  }
  if (path.length !== 3) return notFound;
  if (method === "GET") {
    switch (sub) {
      case "transfers": return { status: 200, body: { data: await b.searchTransfers(id, { reference: str(query.get("reference")), recipient: str(query.get("recipient")), amount: num(query.get("amount")) }) } };
      case "incoming-payments": return { status: 200, body: { data: await b.searchIncomingPayments(id, { amount: num(query.get("amount")), currency: str(query.get("currency")) }) } };
      case "verification": { const v = await b.getVerification(id); return v ? { status: 200, body: v } : notFound; }
      case "balances": return { status: 200, body: { data: await b.getBalances(id) } };
      case "fees": {
        const kind = query.get("kind");
        return { status: 200, body: { data: await b.listFees(id, { id: str(query.get("id")), kind: kind === "fee" || kind === "conversion" ? kind : undefined, transfer: str(query.get("transfer")), since: str(query.get("since")) }) } };
      }
      case "cards": return { status: 200, body: { data: await b.listCards(id, { last4: str(query.get("last4")) }) } };
      case "card-transactions": {
        const status = query.get("status") as (typeof TX_STATUSES)[number] | null;
        return { status: 200, body: { data: await b.searchCardTransactions(id, { id: str(query.get("id")), card: str(query.get("card")), status: status && TX_STATUSES.includes(status) ? status : undefined, since: str(query.get("since")), merchant: str(query.get("merchant")), amount: num(query.get("amount")) }) } };
      }
      case "payments": return { status: 200, body: { data: await b.searchPayments(id, { amount: num(query.get("amount")), channel: str(query.get("channel")), card_last4: str(query.get("card_last4")), merchant: str(query.get("merchant")) }) } };
      case "loans": return { status: 200, body: { data: await b.listLoans(id, { id: str(query.get("id")) }) } };
      case "merchant-payouts": return { status: 200, body: { data: await b.listMerchantPayouts(id, { id: str(query.get("id")) }) } };
      case "merchant-holds": return { status: 200, body: { data: await b.listMerchantHolds(id) } };
      case "bill-payments": return { status: 200, body: { data: await b.searchBillPayments(id, { id: str(query.get("id")), amount: num(query.get("amount")), kind: str(query.get("kind")) }) } };
      case "ussd-sessions": return { status: 200, body: { data: await b.searchUssdSessions(id, { amount: num(query.get("amount")), kind: str(query.get("kind")) }) } };
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
