import type { BankConnector, BankUser, Balance, FeeRecord, IdentityCheck, IncomingPayment, RecallRequest, RecallResult, Restriction, Transfer, Verification } from "./contract.ts";

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
  };
}
