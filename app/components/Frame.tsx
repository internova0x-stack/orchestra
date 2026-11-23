"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Chat from "./Chat";

const TABS = [
  { href: "/", label: "Chat" },
  { href: "/rules", label: "Rules" },
  { href: "/staff", label: "Staff queue" },
];

import { RESET_EVENT } from "./events";

/** The app frame on every screen: prototype banner, top bar with tabs, theme switch and Reset demo. */
export default function Frame({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [toast, setToast] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

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
      window.dispatchEvent(new Event(RESET_EVENT));
      setToast("Demo reset. The sample data is back to its starting state.");
    } catch {
      setToast("The reset didn't work. Check that the database is connected, then try again.");
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="app">
      <div className="banner" role="note">Prototype - simulated data</div>
      <header className="topbar">
        <div className="wordmark">Orchestra <span>AI</span></div>
        <nav className="tabs" aria-label="Screens">
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} className="tab" aria-current={path === t.href ? "page" : undefined}>
              {t.label}
            </Link>
          ))}
        </nav>
        <div className="topbar-right">
          <button className="btn" onClick={switchTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
            {theme === "dark" ? "Light" : "Dark"}
          </button>
          <button className="btn" onClick={reset} disabled={resetting}>
            {resetting ? "Resetting…" : "Reset demo"}
          </button>
        </div>
      </header>
      <main className="page">
        {/* The chat stays mounted on every tab, so a conversation survives a visit to the Staff
            queue and the team's decision appears in it. */}
        <div className="page-fill" hidden={path !== "/"}>
          <Chat />
        </div>
        {path !== "/" && children}
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
