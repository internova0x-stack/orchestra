"use client";

import { useCallback, useEffect, useState } from "react";

// Team accounts (operations and IT admins): add people with a role, change roles, switch accounts off, reset passwords.
// New and reset passwords are temporary: shown once here, and the person chooses their own when they sign in.

interface Member { id: string; name: string; email: string | null; role: string; active: boolean; has_password: boolean; must_change: boolean; last_login_at: string | null }
interface RoleInfo { id: string; name: string; about: string }

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Never");

export default function TeamPage() {
  const [team, setTeam] = useState<Member[]>([]);
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [meId, setMeId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("support_agent");
  const [secret, setSecret] = useState<{ who: string; password: string } | null>(null);
  const [demoPw, setDemoPw] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { const close = () => setMenu(null); window.addEventListener("click", close); return () => window.removeEventListener("click", close); }, []);

  const load = useCallback(async () => {
    const j = await fetch("/api/team", { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
    setTeam(j.team ?? []);
    setRoles(j.roles ?? []);
    setMeId(j.me ?? "");
  }, []);
  useEffect(() => { load(); }, [load]);

  async function call(url: string, method: string, body: object) {
    setErr(null);
    setMsg(null);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.ok === false) { setErr(j.error ?? j.message ?? "That didn't go through."); return null; }
    await load();
    return j;
  }

  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? id;
  return (
    <div className="dev-body">
      {err && <div className="case-error" role="alert">{err}</div>}
      {msg && <div className="label" role="status">{msg}</div>}
      {secret && (
        <div className="temp-pw" role="status">
          <div className="temp-pw-text">
            <b>Temporary password for {secret.who}</b>
            <span className="label">Shown once. Send it privately; they choose their own when they sign in.</span>
          </div>
          <code className="temp-pw-code">{secret.password}</code>
          <button className="btn" onClick={() => { navigator.clipboard?.writeText(secret.password).then(() => setCopied(true)).catch(() => {}); }}>{copied ? "Copied" : "Copy"}</button>
          <button className="copy" onClick={() => { setSecret(null); setCopied(false); }}>Done</button>
        </div>
      )}

      <h3 className="dev-h">Add someone</h3>
      <form className="dev-row" onSubmit={async (e) => { e.preventDefault(); const j = await call("/api/team", "POST", { name, email, role }); if (j) { setCopied(false); setSecret({ who: name, password: j.tempPassword }); setName(""); setEmail(""); } }}>
        <input className="filter-input dev-input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
        <input className="filter-input dev-input" type="email" placeholder="Work email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Work email" />
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role" className="team-select">
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <button className="btn btn-primary" type="submit" disabled={!name.trim() || !email.trim()}>Add</button>
      </form>

      <div className="team-wrap">
        <table className="dash-table team-table">
          <colgroup><col className="c-name" /><col className="c-email" /><col className="c-role" /><col className="c-when" /><col className="c-more" /></colgroup>
          <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Last sign-in</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {team.map((m) => (
              <tr key={m.id}>
                <td>
                  <div className="team-name" title={m.name}>{m.name}{m.id === meId ? " (you)" : ""}</div>
                  {!m.active ? <span className="tag tag-declined">Off</span> : !m.has_password ? <span className="tag">No password yet</span> : m.must_change ? <span className="tag tag-pending">Temporary password</span> : null}
                </td>
                <td className="team-email" title={m.email ?? ""}>{m.email ?? "—"}</td>
                <td>
                  <select value={m.role} disabled={m.id === meId} aria-label={`Role for ${m.name}`} className="team-select" onChange={(e) => call(`/api/team/${m.id}`, "PATCH", { role: e.target.value })}>
                    {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </td>
                <td>{when(m.last_login_at)}</td>
                <td className="team-more">
                  <button className="int-dots" aria-label={`More for ${m.name}`} aria-expanded={menu === m.id} onClick={(e) => { e.stopPropagation(); setMenu(menu === m.id ? null : m.id); }}>···</button>
                  {menu === m.id && (
                    <span className="int-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                      <button role="menuitem" onClick={async () => { setMenu(null); const j = await call(`/api/team/${m.id}`, "PATCH", { reset: true }); if (j) { setCopied(false); setSecret({ who: m.name, password: j.tempPassword }); } }}>Reset password</button>
                      {m.id !== meId && <button role="menuitem" className={m.active ? "danger" : ""} onClick={() => { setMenu(null); call(`/api/team/${m.id}`, "PATCH", { active: !m.active }); }}>{m.active ? "Switch off" : "Switch on"}</button>}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="dev-h">What each role can do</h3>
      <dl className="summary">
        {roles.map((r) => <div key={r.id}><dt>{r.name}</dt><dd>{roleName(r.id) && r.about}</dd></div>)}
      </dl>

      <h3 className="dev-h">Try each role (demo)</h3>
      <p className="label">The sample team (Ife, Bayo, Zainab, Lara, Musa, Dayo: invented people, one per role, emails ending @yourbank.example) can sign in with one password you choose here.</p>
      <form className="dev-row" onSubmit={async (e) => { e.preventDefault(); const j = await call("/api/team/demo", "POST", { password: demoPw }); if (j) { setMsg(`The sample team can now sign in with that password (${j.count} accounts).`); setDemoPw(""); } }}>
        <input className="filter-input dev-input" type="password" autoComplete="new-password" placeholder="A password for the sample team" value={demoPw} onChange={(e) => setDemoPw(e.target.value)} aria-label="Sample team password" />
        <button className="btn" type="submit" disabled={!demoPw}>Let the sample team sign in</button>
      </form>
    </div>
  );
}
