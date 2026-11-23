"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// The bank's support console. The customer side is a separate app at /customer, without this frame.
const TABS = [
  { href: "/", label: "Inbox" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/staff", label: "Staff queue" },
  { href: "/rules", label: "Rules" },
];

import { announceReset } from "./events";

/** The console's frame on every screen: prototype banner, top bar with tabs, theme switch and Reset demo. */
export default function Frame({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [toast, setToast] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [service, setService] = useState<{ alexisOn: boolean; outage: string | null }>({ alexisOn: true, outage: null });

  // The service status for the whole team: Alexis switched off, or outage mode on (Rules, Operations).
  useEffect(() => {
    if (path.startsWith("/customer") || path === "/login") return;
    const load = () => fetch("/api/status", { cache: "no-store" }).then((r) => r.json()).then(setService).catch(() => {});
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 10_000);
    return () => clearInterval(t);
  }, [path]);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  function switchTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (next === "light") document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem("orchestra-theme", next);
    } catch {}
  }

  async function reset() {
    setResetting(true);
    try {
      const res = await fetch("/api/reset", { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      announceReset();
      setToast("Demo reset. The sample data is back to its starting state.");
    } catch {
      setToast("The reset didn't work. Check that the database is connected, then try again.");
    } finally {
      setResetting(false);
    }
  }

  // The customer app has its own look: no console tabs or buttons.
  if (path.startsWith("/customer") || path === "/login") return <>{children}</>;

  return (
    <div className="app">
      <div className="banner" role="note">Prototype - simulated data</div>
      <header className="topbar">
        <div className="wordmark">Orchestra <span>AI</span><span className="wordmark-sub">Support console</span></div>
        <nav className="tabs" aria-label="Screens">
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} className="tab" aria-current={path === t.href ? "page" : undefined}>
              {t.label}
            </Link>
          ))}
        </nav>
        <div className="topbar-right">
          <a className="btn btn-link" href="/customer" target="_blank" rel="noopener">Open customer app ↗</a>
          <button className="btn" onClick={switchTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
            {theme === "dark" ? "Light" : "Dark"}
          </button>
          <button className="btn" onClick={reset} disabled={resetting}>
            {resetting ? "Resetting…" : "Reset demo"}
          </button>
        </div>
      </header>
      {(!service.alexisOn || service.outage) && (
        <div className="service-bar" role="status">
          {!service.alexisOn && <span><b>Alexis is switched off.</b> Every customer message waits for the team in the Inbox.</span>}
          {service.outage && <span><b>Outage mode is on.</b> Customers see: “{service.outage}”</span>}
          <Link href="/rules?category=Operations">Change in Rules › Operations</Link>
        </div>
      )}
      <main className="page">{children}</main>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
