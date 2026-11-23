// The API page: how banks and other systems connect to Orchestra, and the keys and webhooks for the
// Orchestra API. The machine-readable contracts are the OpenAPI files in /public/openapi.
import ApiAdmin from "./Admin";

const ORCHESTRA_ENDPOINTS: [string, string, string][] = [
  ["POST", "/conversations", "Open a conversation for a customer, on a channel; pass the bank's user id for a customer already signed in to its app"],
  ["POST", "/conversations/{id}/messages", "Send the customer's message (or their identity answers, a Yes/Cancel, a code); returns Alexis's reply and any form the channel should show"],
  ["GET", "/conversations/{id}", "The conversation so far, who is handling it, and whether it's waiting for the team"],
  ["POST", "/events", "Report a status change (recall, reversal, dispute, verification); Alexis's proactive updates follow. The same event id twice applies once"],
];

const WEBHOOK_DOCS: [string, string][] = [
  ["case.created", "Alexis handed a conversation to the team, with the handoff summary, urgency and response target"],
  ["case.updated", "a supervisor approved or declined, or the team resolved a case"],
  ["conversation.taken_over / handed_back", "a member of the team took a conversation over, or handed it back to Alexis"],
  ["conversation.reviewed", "the team reviewed a conversation (good or needs work)"],
  ["message.created", "a reply to the customer from Alexis or the team"],
  ["customer.notified", "a proactive status update went to the customer's phone on file"],
];

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
        <div className="panel-head"><span className="panel-title">The Orchestra API</span></div>
        <div className="dev-body">
          <p>
            For systems that call Orchestra, and the webhooks Orchestra sends them. A bank&apos;s app, WhatsApp provider or mailbox
            brings customers&apos; messages to Alexis; the bank reports status changes so Alexis&apos;s proactive updates go out; and a
            CRM or helpdesk receives each handoff, decision and reply as a webhook, so the team can keep working where they already work.
          </p>
          <div className="dev-row">
            <a className="btn btn-primary" href="/openapi/orchestra-api-v1.yaml" download>Download the OpenAPI file</a>
            <span className="label">OpenAPI 3.1 · version 1 · endpoints and webhook events</span>
          </div>
          <h3 className="dev-h">Endpoints (under /api/v1, with an API key)</h3>
          <div className="table-wrap">
            <table className="dash-table dev-table">
              <thead><tr><th scope="col">Method</th><th scope="col">Path</th><th scope="col">What it does</th></tr></thead>
              <tbody>
                {ORCHESTRA_ENDPOINTS.map(([m, p, d]) => (
                  <tr key={m + p}><td><span className={`tag ${m === "POST" ? "tag-market" : ""}`}>{m}</span></td><td><span className="ref">{p}</span></td><td className="dev-desc">{d}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="dev-h">Webhook events</h3>
          <ul className="dev-list">{WEBHOOK_DOCS.map(([e, d]) => <li key={e}><span className="ref">{e}</span>: {d}</li>)}</ul>
          <p className="label">
            Each delivery carries <span className="ref">Orchestra-Signature: t=…,v1=…</span>, an HMAC-SHA256 of &quot;t.body&quot; with the endpoint&apos;s
            secret. A CRM opens a ticket on <span className="ref">case.created</span> and updates it on <span className="ref">case.updated</span>; a channel
            delivers <span className="ref">message.created</span> to the customer.
          </p>
          <pre className="dev-code">{`curl -X POST https://orchestra-plum.vercel.app/api/v1/conversations \\
  -H "Authorization: Bearer $ORCHESTRA_API_KEY" -H "Content-Type: application/json" \\
  -d '{"channel":"whatsapp","verified_user_id":"ada"}'`}</pre>
        </div>
        <ApiAdmin />
      </section>
    </div>
  );
}
