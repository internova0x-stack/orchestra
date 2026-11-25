"use client";

import { useEffect, useRef, useState } from "react";

// A sample bank website with the website chat on it (lib/widget.ts), to try the widget before pasting its line on a
// real site. Orchestra's own address is always allowed to show the chat. "Signed in as" asks the server to sign a
// token for a sample customer (never with a secret typed here), as the bank's own server would.

interface W { set: boolean; key?: string; title?: string; live?: boolean; secretLast4?: string | null }
interface U { id: string; name: string; business: string; role: string }
declare global { interface Window { OrchestraChat?: { open: () => void; close: () => void; identify: (t: string) => void } } }

export default function TryWidget() {
  const [w, setW] = useState<W | null>(null);
  const [users, setUsers] = useState<U[]>([]);
  const [who, setWho] = useState("guest");
  const [note, setNote] = useState<string | null>(null);
  const added = useRef(false);

  useEffect(() => {
    document.documentElement.dataset.theme = "light";
    fetch("/api/admin/widget", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => setW(j ?? { set: false })).catch(() => setW({ set: false }));
    fetch("/api/users", { cache: "no-store" }).then((r) => r.json()).then((j) => setUsers(j.users ?? [])).catch(() => {});
  }, []);

  // The bank's one line, added once the widget is known to be live.
  useEffect(() => {
    if (!w?.set || !w.live || !w.key || added.current) return;
    added.current = true;
    const s = document.createElement("script");
    s.src = "/widget.js";
    s.async = true;
    s.dataset.key = w.key;
    document.body.appendChild(s);
  }, [w]);

  async function signIn(id: string) {
    setWho(id);
    setNote(null);
    if (id === "guest") { setNote("Guest: start a new conversation from the chat to see the identity check. A page reload starts as a guest."); return; }
    const r = await fetch("/api/admin/widget", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "demo_token", customer: id }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.token) { setNote(j.error ?? "That didn't work."); setWho("guest"); return; }
    window.OrchestraChat?.identify(j.token);
    window.OrchestraChat?.open();
    setNote(`Signed in: the chat starts a new conversation as ${users.find((u) => u.id === id)?.name ?? id}, already verified.`);
  }

  return (
    <div className="try">
      <div className="banner" role="note">Prototype · a sample bank website (invented) with your website chat on it</div>
      <div className="try-tester">
        <b>Playing the visitor</b>
        <label>
          <span className="sr-only">Visitor</span>
          <select value={who} onChange={(e) => signIn(e.target.value)} disabled={!w?.live}>
            <option value="guest">A guest (not signed in)</option>
            {users.map((u) => <option key={u.id} value={u.id}>Signed in as {u.name}</option>)}
          </select>
        </label>
        {note && <span role="status">{note}</span>}
        {w?.live && !w.secretLast4 && <span>To try a signed-in visitor, create the signing secret on the API page first.</span>}
      </div>
      {w && (!w.set || !w.live) && (
        <div className="try-off" role="status">
          {w.set ? "The website chat is paused. Go live on the API page (Channels → Website chat) to see it here." : "Set up the website chat on the API page first (Channels → Website chat)."}
          <a className="btn" href="/developers">Open the API page</a>
        </div>
      )}
      <header className="try-site-head"><span className="try-logo">Sample Bank</span><nav><span>Business</span><span>Personal</span><span>Help</span><span>Sign in</span></nav></header>
      <main className="try-site">
        <h1>Banking for businesses that move fast</h1>
        <p>This is a stand-in for your own website. The chat button in the corner is the line you paste on your pages. It opens Alexis in your colours; your team sees every conversation in Messages and can take over.</p>
        <div className="try-cards">
          <div><b>Payouts</b><span>Send money to suppliers in ₦, $ and £.</span></div>
          <div><b>Cards</b><span>Freeze, unfreeze and set limits.</span></div>
          <div><b>Help</b><span>Questions? Use the chat in the corner.</span></div>
        </div>
      </main>
    </div>
  );
}
