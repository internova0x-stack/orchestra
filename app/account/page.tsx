"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

// Your own account: who you are, your role, and changing your password (required after a temporary one).

function Account() {
  const params = useSearchParams();
  const first = params.get("first") === "1";
  const [me, setMe] = useState<{ name: string; email: string | null; roleName: string; must_change: boolean } | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { fetch("/api/staff/users", { cache: "no-store" }).then((r) => r.json()).then((j) => setMe(j.me ?? null)).catch(() => {}); }, []);

  async function change(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setErr(null);
    const res = await fetch("/api/auth/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current, next }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.ok === false) { setErr(j.error ?? "That didn't go through."); return; }
    setCurrent("");
    setNext("");
    if (me?.must_change) { window.location.assign("/"); return; }
    setMsg("Password changed.");
  }

  if (!me) return <div className="empty">Loading…</div>;
  return (
    <div className="dev-body">
      {(first || me.must_change) && <div className="secret-box" role="status"><b>Choose your own password.</b> You signed in with a temporary one; choose a new one to carry on.</div>}
      <dl className="summary">
        <div><dt>Name</dt><dd>{me.name}</dd></div>
        <div><dt>Email</dt><dd>{me.email}</dd></div>
        <div><dt>Role</dt><dd>{me.roleName}</dd></div>
      </dl>
      <h3 className="dev-h">Change your password</h3>
      <form className="dev-stack" onSubmit={change} style={{ maxWidth: 420 }}>
        <label className="sr-only" htmlFor="cur">Current password</label>
        <input id="cur" className="filter-input" type="password" autoComplete="current-password" placeholder={me.must_change ? "Temporary password" : "Current password"} value={current} onChange={(e) => setCurrent(e.target.value)} />
        <label className="sr-only" htmlFor="new">New password</label>
        <input id="new" className="filter-input" type="password" autoComplete="new-password" placeholder="New password (10+ characters, with a number)" value={next} onChange={(e) => setNext(e.target.value)} />
        {err && <div className="case-error" role="alert">{err}</div>}
        {msg && <div className="label" role="status">{msg}</div>}
        <button className="btn btn-primary" type="submit" disabled={!current || !next}>Change password</button>
      </form>
    </div>
  );
}

export default function AccountPage() {
  return <Suspense fallback={null}><Account /></Suspense>;
}
