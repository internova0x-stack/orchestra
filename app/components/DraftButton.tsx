"use client";

import { useState } from "react";

/** "Draft with Alexis": fills the reply box with a draft for the team member to edit. Nothing is sent. */
export default function DraftButton({ conversationId, staffId, onDraft, disabled }: { conversationId: string | null; staffId: string; onDraft: (text: string) => void; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function draft() {
    if (!conversationId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, staffId }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.draft) setError(json.message ?? "Alexis couldn't draft a reply just now.");
      else onDraft(json.draft);
    } catch {
      setError("Couldn't reach the app's server.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" className="btn" onClick={draft} disabled={busy || disabled || !conversationId} title="Alexis drafts a reply from the conversation and the case; you edit it before sending">
        {busy ? "Drafting…" : "Draft with Alexis"}
      </button>
      {error && <span className="case-error" role="alert">{error}</span>}
    </>
  );
}
