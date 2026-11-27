import type { ActionRequest, ActionResult, BankConnector, CardSettings, BankUser, Balance, BillPayment, Card, CardTransaction, Contact, FeeRecord, IdentityCheck, IncomingPayment, Loan, MerchantHold, MerchantPayout, Payment, PaymentEvent, RecallRequest, RecallResult, Restriction, Transfer, UssdSession, Verification, CheckoutPayment, InterbankStatus } from "./contract.ts";

// The Bank Connector API over HTTPS: Orchestra calls any bank that implements the contract
// (public/openapi/bank-connector-v1.yaml). Set BANK_API_URL (e.g. https://bank.example/orchestra/v1) and
// BANK_API_KEY in the environment; the key goes in the Authorization header and never reaches the browser.

export class BankApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function httpBank(baseUrl: string, apiKey: string, fetcher: typeof fetch = fetch): BankConnector {
  const base = baseUrl.replace(/\/+$/, "");

  async function call<T>(method: "GET" | "POST", path: string, opts: { query?: Record<string, string | number | undefined>; body?: unknown; idempotencyKey?: string } = {}): Promise<T> {
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    // A read is retried once on a network error or a 5xx; an action is never retried blindly (its idempotency
    // key makes a later retry by the caller safe).
    for (let attempt = 0; ; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10_000);
      try {
        const res = await fetcher(url, {
          method,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
            ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
            ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
          },
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: ctrl.signal,
        });
        if (res.status === 404) return null as T;
        if (!res.ok) {
          if (method === "GET" && res.status >= 500 && attempt === 0) continue;
          const text = await res.text().catch(() => "");
          throw new BankApiError(res.status, `Bank API ${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
        }
        return (await res.json()) as T;
      } catch (err) {
        if (err instanceof BankApiError) throw err;
        if (method === "GET" && attempt === 0) continue;
        throw new BankApiError(0, `Bank API ${method} ${path}: ${(err as Error).message}`);
      } finally {
        clearTimeout(timer);
      }
    }
  }

  const holder = (id: string) => `/holders/${encodeURIComponent(id)}`;
  const list = async <T>(p: Promise<{ data: T[] } | null>) => (await p)?.data ?? [];
  const seg = encodeURIComponent;
  const act = (path: string, req: ActionRequest, key: string) =>
    call<ActionResult>("POST", path, { body: req, idempotencyKey: key }).then((r) => r ?? { accepted: false, bank_reference: null, status: "not_found" });

  return {
    kind: "http",
    verifyIdentity: (check: IdentityCheck) => call<{ user_id: string | null }>("POST", "/identity/verify", { body: check }).then((r) => r ?? { user_id: null }),
    getUser: (userId: string) => call<BankUser | null>("GET", `/users/${encodeURIComponent(userId)}`),
    searchTransfers: (h, q) => list(call<{ data: Transfer[] }>("GET", `${holder(h)}/transfers`, { query: q })),
    searchIncomingPayments: (h, q) => list(call<{ data: IncomingPayment[] }>("GET", `${holder(h)}/incoming-payments`, { query: q })),
    getVerification: (h) => call<Verification | null>("GET", `${holder(h)}/verification`),
    getBalances: (h) => list(call<{ data: Balance[] }>("GET", `${holder(h)}/balances`)),
    listFees: (h, q) => list(call<{ data: FeeRecord[] }>("GET", `${holder(h)}/fees`, { query: q })),
    listRestrictions: (h, q) => list(call<{ data: Restriction[] }>("GET", `${holder(h)}/restrictions`, { query: q })),
    requestRecall: (h, req: RecallRequest, key: string) => call<RecallResult>("POST", `${holder(h)}/recalls`, { body: req, idempotencyKey: key }),

    findUserByContact: (q) => call<BankUser | null>("GET", "/users", { query: { email: q.email, phone: q.phone } }),
    getContact: (userId) => call<Contact | null>("GET", `/users/${seg(userId)}/contact`),
    unlockLogin: (userId, req, key) => act(`/users/${seg(userId)}/unlock`, req, key),
    listCards: (h, q) => list(call<{ data: Card[] }>("GET", `${holder(h)}/cards`, { query: q })),
    freezeCard: (h, id, req, key) => act(`${holder(h)}/cards/${seg(id)}/freeze`, req, key),
    replaceCard: (h, id, req, key) => act(`${holder(h)}/cards/${seg(id)}/replace`, req, key),
    unfreezeCard: (h, id, req, key) => act(`${holder(h)}/cards/${seg(id)}/unfreeze`, req, key),
    updateCardSettings: (h, id, settings: CardSettings, req, key) =>
      call<ActionResult>("POST", `${holder(h)}/cards/${seg(id)}/settings`, { body: { ...req, settings }, idempotencyKey: key }).then((r) => r ?? { accepted: false, bank_reference: null, status: "not_found" }),
    searchCardTransactions: (h, q) => list(call<{ data: CardTransaction[] }>("GET", `${holder(h)}/card-transactions`, { query: q })),
    searchPayments: (h, q) => list(call<{ data: Payment[] }>("GET", `${holder(h)}/payments`, { query: q })),
    getPayment: (h, id) => call<{ payment: Payment | null; elsewhere: boolean }>("GET", `${holder(h)}/payments/${seg(id)}`).then((r) => r ?? { payment: null, elsewhere: false }),
    getPaymentEvents: (h, id) => list(call<{ data: PaymentEvent[] }>("GET", `${holder(h)}/payments/${seg(id)}/events`)),
    listLoans: (h, q) => list(call<{ data: Loan[] }>("GET", `${holder(h)}/loans`, { query: q })),
    listMerchantPayouts: (h, q) => list(call<{ data: MerchantPayout[] }>("GET", `${holder(h)}/merchant-payouts`, { query: q })),
    listMerchantHolds: (h) => list(call<{ data: MerchantHold[] }>("GET", `${holder(h)}/merchant-holds`)),
    searchBillPayments: (h, q) => list(call<{ data: BillPayment[] }>("GET", `${holder(h)}/bill-payments`, { query: q })),
    refundBillPayment: (h, id, req, key) => act(`${holder(h)}/bill-payments/${seg(id)}/refund`, req, key),
    searchUssdSessions: (h, q) => list(call<{ data: UssdSession[] }>("GET", `${holder(h)}/ussd-sessions`, { query: q })),
    refundFee: (h, id, req, key) => act(`${holder(h)}/fees/${seg(id)}/refund`, req, key),

    findCheckoutPayments: (q) => list(call<{ data: CheckoutPayment[] }>("GET", "/checkout-payments", { query: q })),
    getCheckoutPayment: (id) => call<CheckoutPayment | null>("GET", `/checkout-payments/${seg(id)}`),
    getTransferStatus: async (reference) =>
      (await call<InterbankStatus | null>("GET", `/transfer-status/${seg(reference)}`)) ?? { reference, network: null, status: "not_found", beneficiary_account_last4: null, at: null, detail: null },
    resendMerchantNotification: (id, req, key) => act(`/checkout-payments/${seg(id)}/resend-notification`, req, key),
    refundCheckoutPayment: (id, req, key) => act(`/checkout-payments/${seg(id)}/refund`, req, key),
  };
}
