"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { safeNext } from "@/lib/sitePassword";

function LoginForm() {
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError((json as { error?: string }).error ?? "That didn't work. Try again."); return; }
      window.location.assign(safeNext(params.get("next")));
    } catch {
      setError("Couldn't reach the app's server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="login-card panel" onSubmit={submit}>
      <div className="wordmark">Orchestra <span>AI</span></div>
      <p className="label">This prototype is private. Enter the password you were given.</p>
      <label className="sr-only" htmlFor="site-password">Password</label>
      <input id="site-password" className="filter-input" type="password" autoComplete="current-password" autoFocus
        value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
      {error && <div className="case-error" role="alert">{error}</div>}
      <button className="btn btn-primary" type="submit" disabled={busy || !password}>{busy ? "Checking…" : "Continue"}</button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="login-page">
      <div className="banner" role="note">Prototype - simulated data</div>
      <div className="login-stage">
        <Suspense fallback={null}><LoginForm /></Suspense>
      </div>
    </div>
  );
}
