"use client";
import { useState } from "react";
import { api } from "./api";

export function ShareButton() {
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="stack" style={{ ["--gap" as string]: "8px" }}>
      <button
        className="btn sm"
        onClick={async () => {
          const r = await api<{ path: string }>("/api/me/share", { method: "POST" });
          setLink(`${location.origin}${r.path}`);
        }}
      >
        Create a share link
      </button>
      {link && (
        <div className="row small">
          <input className="input" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Share link" style={{ flex: 1, minWidth: 200 }} />
          <button className="btn sm ghost" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch {} }}>{copied ? "Copied" : "Copy"}</button>
        </div>
      )}
      <p className="tiny muted" style={{ margin: 0 }}>Shares your weekly summary only — never your answers. Expires in 14 days.</p>
    </div>
  );
}
