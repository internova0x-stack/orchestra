// The API page: how banks and other systems connect to Orchestra. Static; the machine-readable
// contracts are the OpenAPI files in /public/openapi.

const BANK_ENDPOINTS: [string, string, string][] = [
  ["POST", "/identity/verify", "Check a customer's identity (name, date of birth, registration number or a personal account's last 4); returns the user it identifies"],
  ["GET", "/users/{userId}", "A verified user's profile: name, role, account holder, personal or business, country"],
  ["GET", "/holders/{holderId}/transfers", "Search the holder's payouts by reference, recipient or amount"],
  ["GET", "/holders/{holderId}/incoming-payments", "Payments sent to the holder, plus unallocated payments to match"],
  ["GET", "/holders/{holderId}/verification", "Verification (KYC) status, what's missing, the tier"],
  ["GET", "/holders/{holderId}/balances", "Balances, one per currency"],
  ["GET", "/holders/{holderId}/fees", "Fees charged and currency conversions"],
  ["GET", "/holders/{holderId}/restrictions", "Restrictions; a review hold is a flag with no reason"],
  ["POST", "/holders/{holderId}/recalls", "Request a recall (with an Idempotency-Key), after Orchestra's checks and the customer's yes"],
];

const RULES = [
  "Every record belongs to an account holder; Orchestra passes the verified customer's holder id and the bank returns only theirs (anything else is a 404).",
  "Amounts are decimal strings in the currency's major unit (\"4200.00\"); currencies are ISO 4217; times are ISO 8601.",
  "A review hold is a flag only. The bank never sends the reason, so Alexis can't reveal it.",
  "Full account numbers may be returned; Orchestra masks them to the last 4 before the AI sees them.",
  "Actions carry an Idempotency-Key: the same key twice returns the first result and never acts twice.",
];

export default function DevelopersPage() {
  return (
    <div className="dev">
      <section className="panel dev-section">
        <div className="panel-head"><span className="panel-title">Connecting a bank</span></div>
        <div className="dev-body">
          <p>
            Orchestra reads a bank&apos;s records and requests actions through one published contract, the <b>Bank Connector API</b>.
            A bank, or its middleware, implements it once; nothing else in Orchestra changes. All of Alexis&apos;s checks
            (identity, ownership of the record, review holds, caps, approvals, confirmation, duplicates) stay inside Orchestra.
          </p>
          <div className="dev-row">
            <a className="btn btn-primary" href="/openapi/bank-connector-v1.yaml" download>Download the OpenAPI file</a>
            <span className="label">OpenAPI 3.1 · version 1 · works with any OpenAPI tool or code generator</span>
          </div>

          <h3 className="dev-h">Endpoints the bank implements</h3>
          <div className="table-wrap">
            <table className="dash-table dev-table">
              <thead><tr><th scope="col">Method</th><th scope="col">Path</th><th scope="col">What it returns or does</th></tr></thead>
              <tbody>
                {BANK_ENDPOINTS.map(([m, p, d]) => (
                  <tr key={p}><td><span className={`tag ${m === "POST" ? "tag-market" : ""}`}>{m}</span></td><td><span className="ref">{p}</span></td><td className="dev-desc">{d}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="dev-h">Rules of the contract</h3>
          <ul className="dev-list">{RULES.map((r) => <li key={r}>{r}</li>)}</ul>

          <h3 className="dev-h">Switching Orchestra to a bank</h3>
          <ol className="dev-list">
            <li>The bank gives you its base address (for example <span className="ref">https://bank.example/orchestra/v1</span>) and an API key.</li>
            <li>In Vercel, add <span className="ref">BANK_API_URL</span> and <span className="ref">BANK_API_KEY</span> (Settings, Environment Variables), then redeploy.</li>
            <li>Alexis now reads that bank. Remove the two settings to go back to the simulated bank.</li>
          </ol>
          <p className="label">
            Version 1 covers identity, the customer, payouts, incoming payments, verification, balances, fees, restrictions and recalls.
            Cards, loans, bills, disputes and the other areas still read the simulated bank, and follow the same pattern next.
          </p>

          <h3 className="dev-h">Try the reference implementation</h3>
          <p>
            This prototype serves the contract itself, backed by its simulated bank, at <span className="ref">/api/bank/v1</span>. It&apos;s on
            when <span className="ref">BANK_API_KEY</span> is set. With the key, for example:
          </p>
          <pre className="dev-code">{`curl -H "Authorization: Bearer $BANK_API_KEY" \\
  "https://orchestra-plum.vercel.app/api/bank/v1/holders/brightline/transfers?recipient=Lumen"`}</pre>
          <p className="label">
            Pointing <span className="ref">BANK_API_URL</span> at <span className="ref">https://&lt;this site&gt;/api/bank/v1</span> runs the whole demo through the
            contract over HTTPS, the same path a real bank would use.
          </p>
        </div>
      </section>

      <section className="panel dev-section">
        <div className="panel-head"><span className="panel-title">The Orchestra API</span><span className="tag">Next step</span></div>
        <div className="dev-body">
          <p>
            For systems that call Orchestra: a channel API (a bank&apos;s app, WhatsApp provider or mailbox sends customer messages in
            and gets Alexis&apos;s replies back), an events API (status changes that drive Alexis&apos;s proactive updates) and webhooks
            (handoffs, decisions and reviews sent to a helpdesk or CRM), with an API key per institution.
          </p>
        </div>
      </section>
    </div>
  );
}
