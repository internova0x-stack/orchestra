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
  team: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  external: <><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>,
};
const Icon = ({ name }: { name: string }) => <svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[name]}</svg>;

// Each screen and the permission that shows it (lib/auth.ts). The server checks every request as well.
const TABS = [
  { href: "/dashboard", label: "Dashboard", icon: "chart", perm: "dashboard_view" },
  { href: "/messages", label: "Messages", icon: "inbox", perm: "inbox_view" },
  { href: "/staff", label: "Staff queue", icon: "people", perm: "staff_queue_view" },
  { href: "/rules", label: "Rules", icon: "sliders", perm: "rules_view" },
  { href: "/billing", label: "Plan and usage", icon: "receipt", perm: "billing_view" },
  { href: "/team", label: "Team", icon: "team", perm: "team_manage" },
];
const PAGE_PERM: Record<string, string> = { ...Object.fromEntries(TABS.map((t) => [t.href, t.perm])), "/": "", "/developers": "api_view", "/account": "" };
interface Me { id: string; name: string; email: string | null; role: string; roleName: string; must_change: boolean }

import { announceReset } from "./events";

/** The console's frame on every screen: prototype banner, top bar with tabs, theme switch and Reset demo. */
export default function Frame({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [toast, setToast] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [service, setService] = useState<{ alexisOn: boolean; outage: string | null }>({ alexisOn: true, outage: null });
  const [me, setMe] = useState<Me | null>(null);
  // The sidebar folds to its icons; the choice is kept on this device.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { try { setCollapsed(localStorage.getItem("orchestra-sidebar") === "collapsed"); } catch {} }, []);
  const toggleSidebar = () => setCollapsed((c) => { try { localStorage.setItem("orchestra-sidebar", c ? "open" : "collapsed"); } catch {} return !c; });
  const [perms, setPerms] = useState<string[]>([]);
  const outside = path.startsWith("/customer") || path === "/login" || path === "/signin";

  // Who is signed in, and what their role allows. Not signed in: to the sign-in page.
  useEffect(() => {
    if (outside) return;
    fetch("/api/staff/users", { cache: "no-store" }).then(async (r) => {
      if (r.status === 401) { window.location.assign(`/signin?next=${encodeURIComponent(path)}`); return; }
      const j = await r.json();
      setMe(j.me ?? null);
      setPerms(j.permissions ?? []);
      if (j.me?.must_change && path !== "/account") window.location.assign("/account?first=1");
      // The console's address starts each person on their first screen: the Dashboard (Tomi, Nov 23), or the first
      // one their role has. An old conversation link (/?c=…) goes to Messages.
      const p: string[] = j.permissions ?? [];
      if (path === "/") {
        const c = new URLSearchParams(window.location.search).get("c");
        window.location.replace(c && p.includes("inbox_view") ? `/messages?c=${encodeURIComponent(c)}` : TABS.find((t) => p.includes(t.perm))?.href ?? (p.includes("api_view") ? "/developers" : "/account"));
      }
    }).catch(() => {});
  }, [path, outside]);

  async function signOut() {
    await fetch("/api/auth/signout", { method: "POST" }).catch(() => {});
    window.location.assign("/signin");
  }

  // The service status for the whole team: Alexis switched off, or outage mode on (Rules, Operations).
  useEffect(() => {
    if (outside) return;
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
  if (outside) return <>{children}</>;
  const allowed = (href: string) => { const p = PAGE_PERM[href]; return p === undefined || p === "" || perms.includes(p); };
  const home = TABS.find((t) => perms.includes(t.perm))?.href ?? "/account";

  const current = TABS.find((x) => x.href === path)?.label ?? (path === "/developers" ? "API" : path === "/account" ? "Your account" : "Support console");

  return (
    <div className={`app${collapsed ? " sidebar-collapsed" : ""}`}>
      <div className="banner" role="note">Prototype - simulated data</div>
      <div className="shell">
        {/* Sidebar (design system: ds-sidebar) */}
        <aside className="sidebar" aria-label="Console">
          <div className="workspace">
            <span className="workspace-mark" aria-hidden="true">O</span>
            <span className="workspace-name">Orchestra <span>AI</span></span>
            <button className="sidebar-toggle" onClick={toggleSidebar} aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"} aria-expanded={!collapsed} title={collapsed ? "Expand" : "Collapse"}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" />{collapsed ? <path d="m13 10 2 2-2 2" /> : <path d="m15 10-2 2 2 2" />}</svg>
            </button>
          </div>
          <nav aria-label="Screens">
            <ul className="nav">
              {TABS.filter((x) => perms.includes(x.perm)).map((x) => (
                <li key={x.href}>
                  <Link href={x.href} className="tab" title={collapsed ? x.label : undefined} aria-current={path === x.href ? "page" : undefined}><Icon name={x.icon} /><span className="tab-label">{x.label}</span></Link>
                </li>
              ))}
            </ul>
            {perms.includes("api_view") && <>
              <p className="nav-label">Developers</p>
              <ul className="nav">
                <li><Link href="/developers" className="tab" title={collapsed ? "API" : undefined} aria-current={path === "/developers" ? "page" : undefined}><Icon name="code" /><span className="tab-label">API</span></Link></li>
              </ul>
            </>}
            <p className="nav-label">Testing</p>
            <ul className="nav">
              <li><a className="tab" href="/customer" target="_blank" rel="noopener" title={collapsed ? "Customer app" : undefined}><Icon name="external" /><span className="tab-label">Customer app</span></a></li>
            </ul>
          </nav>
          {me && (
            <div className="me">
              <Link href="/account" className="me-avatar" title={`${me.name} · ${me.roleName}`} aria-hidden={!collapsed}>{me.name.charAt(0)}</Link>
              <Link href="/account" className="me-name">{me.name}</Link>
              <span className="label">{me.roleName}</span>
              <button className="btn btn-link" onClick={signOut}>Sign out</button>
            </div>
          )}
        </aside>
        <div className="main">
          <header className="topbar">
            <h1 className="page-title">{current}</h1>
            <div className="topbar-right">
              {me && (
                <Link href="/account" className="topbar-me" title="Your account">
                  <span className="topbar-avatar" aria-hidden="true">{me.name.charAt(0)}</span>
                  <span>{me.name}</span>
                  <span className="topbar-role">{me.roleName}</span>
                </Link>
              )}
              <button className="btn" onClick={switchTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
                {theme === "dark" ? "Light" : "Dark"}
              </button>
              {perms.includes("demo_reset") && (
                <button className="btn" onClick={reset} disabled={resetting}>
                  {resetting ? "Resetting…" : "Reset demo"}
                </button>
              )}
            </div>
          </header>
          {(!service.alexisOn || service.outage) && (
            <div className="service-bar" role="status">
              {!service.alexisOn && <span><b>Alexis is switched off.</b> Every customer message waits for the team in Messages.</span>}
              {service.outage && <span><b>Outage mode is on.</b> Customers see: “{service.outage}”</span>}
              <Link href="/rules?category=Operations">Change in Rules › Operations</Link>
            </div>
          )}
          <main className="page">
            {!me ? <div className="empty">Checking your sign-in…</div>
              : allowed(path) ? children
              : <div className="empty">Your role ({me.roleName}) doesn&apos;t include this screen. <Link href={home}>Go to your start page</Link>.</div>}
          </main>
        </div>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
