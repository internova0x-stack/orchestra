"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// The bank's support console. The customer side is a separate app at /customer, without this frame.
// 16px outline icons, 1.5px stroke, round joins (design system: Icons).
const ICONS: Record<string, React.ReactNode> = {
  inbox: <><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>,
  receipt: <><path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2z" /><path d="M9 7h6" /><path d="M9 11h6" /><path d="M9 15h4" /></>,
  chart: <><path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></>,
  people: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  sliders: <><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></>,
  code: <><path d="m16 18 6-6-6-6" /><path d="m8 6-6 6 6 6" /></>,
  external: <><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>,
};
const Icon = ({ name }: { name: string }) => <svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[name]}</svg>;

const TABS = [
  { href: "/", label: "Inbox", icon: "inbox" },
  { href: "/dashboard", label: "Dashboard", icon: "chart" },
  { href: "/staff", label: "Staff queue", icon: "people" },
  { href: "/rules", label: "Rules", icon: "sliders" },
  { href: "/billing", label: "Plan and usage", icon: "receipt" },
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

  const current = TABS.find((x) => x.href === path)?.label ?? (path === "/developers" ? "API" : "Support console");

  return (
    <div className="app">
      <div className="banner" role="note">Prototype - simulated data</div>
      <div className="shell">
        {/* Sidebar (design system: ds-sidebar) */}
        <aside className="sidebar" aria-label="Console">
          <div className="workspace">
            <span className="workspace-mark" aria-hidden="true">O</span>
            <span className="workspace-name">Orchestra <span>AI</span></span>
          </div>
          <nav aria-label="Screens">
            <ul className="nav">
              {TABS.map((x) => (
                <li key={x.href}>
                  <Link href={x.href} className="tab" aria-current={path === x.href ? "page" : undefined}><Icon name={x.icon} />{x.label}</Link>
                </li>
              ))}
            </ul>
            <p className="nav-label">Developers</p>
            <ul className="nav">
              <li><Link href="/developers" className="tab" aria-current={path === "/developers" ? "page" : undefined}><Icon name="code" />API</Link></li>
            </ul>
            <p className="nav-label">Testing</p>
            <ul className="nav">
              <li><a className="tab" href="/customer" target="_blank" rel="noopener"><Icon name="external" />Customer app</a></li>
            </ul>
          </nav>
        </aside>
        <div className="main">
          <header className="topbar">
            <h1 className="page-title">{current}</h1>
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
        </div>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
