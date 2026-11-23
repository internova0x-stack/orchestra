"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

// Signing in to the bank's support console (lib/auth.ts). The first time, with no accounts yet, it creates the first
// operations admin instead.

const safe = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/signin") ? n : "/");

function SignIn() {
  const params = useSearchParams();
  const [setup, setSetup] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/signin", { cache: "no-store" }).then((r) => r.json()).then((j) => setSetup(Boolean(j.needsSetup))).catch(() => setSetup(false));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(setup ? "/api/auth/setup" : "/api/auth/signin", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(setup ? { name, email, password } : { email, password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) { setError(json.error ?? "That didn't work. Try again."); return; }
      window.location.assign(safe(params.get("next")));
    } catch {
      setError("Couldn't reach the app's server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (setup === null) return null;
  return (
    <form className="login-card panel" onSubmit={submit}>
      <div className="wordmark">Orchestra <span>AI</span></div>
      {setup ? (
        <p className="label">Set up the support console: create the first account. It&apos;s an operations admin, who then adds the rest of the team.</p>
      ) : (
        <p className="label">Sign in to the support console.</p>
      )}
      {setup && (
        <>
          <label className="sr-only" htmlFor="name">Your name</label>
          <input id="name" className="filter-input" autoComplete="name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
        </>
      )}
      <label className="sr-only" htmlFor="email">Work email</label>
      <input id="email" className="filter-input" type="email" autoComplete="username" autoFocus placeholder="Work email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <label className="sr-only" htmlFor="password">Password</label>
      <input id="password" className="filter-input" type="password" autoComplete={setup ? "new-password" : "current-password"} placeholder={setup ? "Choose a password (10+ characters, with a number)" : "Password"} value={password} onChange={(e) => setPassword(e.target.value)} />
      {error && <div className="case-error" role="alert">{error}</div>}
      <button className="btn btn-primary" type="submit" disabled={busy || !email || !password || (setup && !name)}>{busy ? "Checking…" : setup ? "Create account and sign in" : "Sign in"}</button>
      {!setup && <p className="label">Forgotten your password? Ask an operations or IT admin to reset it.</p>}
    </form>
  );
}

export default function SignInPage() {
  return (
    <div className="login-page">
      <div className="banner" role="note">Prototype - simulated data</div>
      <div className="login-stage">
        <Suspense fallback={null}><SignIn /></Suspense>
      </div>
    </div>
  );
}
