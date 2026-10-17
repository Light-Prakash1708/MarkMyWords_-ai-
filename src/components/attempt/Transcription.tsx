"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api";

export function Poller({ intervalMs = 1500 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [router, intervalMs]);
  return null;
}

export function PenSpinner({ label }: { label: string }) {
  return (
    <div className="card" style={{ textAlign: "center", padding: 40 }} role="status" aria-live="polite">
      <svg className="spinner-pen" viewBox="0 0 120 60" aria-hidden="true">
        <path d="M5 40 C20 10 30 50 45 25 S70 45 80 20 S105 40 115 15" />
      </svg>
      <h2 className="h3" style={{ marginTop: 10 }}>{label}</h2>
      <p className="small muted">This page updates by itself — you can keep it open.</p>
    </div>
  );
}

export function ManualTranscribe({ attemptId, reason }: { attemptId: string; reason: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [diagram, setDiagram] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/attempts/${attemptId}/transcript`, { body: { text, diagrams: diagram.trim() ? [diagram.trim()] : [] } });
      router.refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save.");
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <div className="note-box small">{reason} Type out what you wrote — exactly as written, including any mistakes — so the evaluation reflects your sheet.</div>
      <div className="sheet">
        <label htmlFor="manual" className="sr-only">Your answer as written</label>
        <textarea id="manual" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your answer exactly as written on the sheet…" />
      </div>
      <div className="field">
        <label htmlFor="diag">Did you draw a diagram or flowchart? Describe it (optional)</label>
        <input id="diag" className="input" value={diagram} onChange={(e) => setDiagram(e.target.value)} maxLength={300} placeholder="e.g. Flowchart: repo rate → cost of funds → lending rate" />
      </div>
      {err && <div className="error-box" role="alert">{err}</div>}
      <button className="btn ink" onClick={go} disabled={busy}>Save transcript</button>
    </div>
  );
}

interface Region { id: string; page: number; start: number; end: number; text: string; confidence: number; alternatives: string[]; flag: "ok" | "uncertain" | "illegible" }

export function ConfirmTranscript({ attemptId, built, uploads }: { attemptId: string; built: { text: string; regions: Region[]; diagrams: { page: number; description: string }[] }; uploads: { id: string; url: string; stored_mime: string }[] }) {
  const router = useRouter();
  const pending = useMemo(() => built.regions.filter((r) => r.flag !== "ok"), [built]);
  const [decisions, setDecisions] = useState<Record<string, { action: "confirm" | "correct" | "leave_uncertain"; text?: string }>>({});
  const [captions, setCaptions] = useState<string[]>(built.diagrams.map(() => ""));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const done = pending.filter((r) => decisions[r.id]).length;

  async function go() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/attempts/${attemptId}/transcript/confirm`, {
        body: { decisions: Object.entries(decisions).map(([region_id, d]) => ({ region_id, ...d })), diagram_captions: captions },
      });
      router.refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not confirm.");
      setBusy(false);
    }
  }

  // Render transcript with uncertain regions highlighted in place.
  const pieces: React.ReactNode[] = [];
  let cur = 0;
  for (const r of built.regions) {
    if (r.start > cur) pieces.push(built.text.slice(cur, r.start));
    if (r.flag === "ok") pieces.push(built.text.slice(r.start, r.end));
    else {
      const d = decisions[r.id];
      pieces.push(
        <a key={r.id} href={`#reg-${r.id}`} className="ocr-unc" style={d ? { outlineStyle: "solid", outlineColor: d.action === "leave_uncertain" ? "var(--uncertain)" : "var(--green-pen)" } : undefined}>
          {d?.action === "correct" ? d.text : built.text.slice(r.start, r.end)}
        </a>,
      );
    }
    cur = r.end;
  }
  if (cur < built.text.length) pieces.push(built.text.slice(cur));

  return (
    <div className="stack">
      <div className="card pastel bg-butter">
        <h2 className="h3">Check what we read</h2>
        <p className="small" style={{ marginBottom: 0 }}>
          We highlighted {pending.length} line{pending.length === 1 ? "" : "s"} we could not read confidently. We never guess silently: confirm each one, correct it, or leave it marked uncertain. Feedback on uncertain lines is flagged as uncertain too.
        </p>
      </div>
      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <div className="stack">
          {uploads.map((u, i) =>
            u.stored_mime === "application/pdf" ? (
              <a key={u.id} className="btn sm" href={u.url} target="_blank" rel="noreferrer">Open PDF page set {i + 1} ↗</a>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={u.id} src={u.url} alt={`Your page ${i + 1}`} style={{ border: "var(--bw) solid var(--line)", borderRadius: 12 }} />
            ),
          )}
        </div>
        <div className="stack">
          <div className="sheet"><div className="answer-text">{pieces}</div></div>
          <div className="stack">
            {pending.map((r, i) => {
              const d = decisions[r.id];
              const set = (v: (typeof decisions)[string]) => setDecisions((x) => ({ ...x, [r.id]: v }));
              return (
                <div id={`reg-${r.id}`} key={r.id} className="card flat" style={{ padding: 14, borderStyle: d ? "solid" : "dashed" }}>
                  <div className="row between">
                    <span className="label">Line {i + 1} · page {r.page + 1} · {r.flag === "illegible" ? "illegible" : `${Math.round(r.confidence * 100)}% sure`}</span>
                    {d && <span className="chip mint">{d.action === "confirm" ? "Confirmed" : d.action === "correct" ? "Corrected" : "Left uncertain"}</span>}
                  </div>
                  <p className="quote">{r.text}</p>
                  <div className="row" style={{ gap: 6 }}>
                    {r.flag !== "illegible" && <button className="btn sm mint" onClick={() => set({ action: "confirm" })}>Reads correctly</button>}
                    {r.alternatives.map((alt) => (
                      <button key={alt} className="btn sm sky" onClick={() => set({ action: "correct", text: alt })} title={alt}>Use: “{alt.slice(0, 40)}{alt.length > 40 ? "…" : ""}”</button>
                    ))}
                    <button className="btn sm ghost" onClick={() => set({ action: "leave_uncertain" })}>Leave uncertain</button>
                  </div>
                  <label className="field" style={{ marginTop: 10 }}>
                    <span className="tiny muted">Or type what you actually wrote</span>
                    <input className="input" defaultValue={d?.action === "correct" ? d.text : ""} onBlur={(e) => e.target.value.trim() && set({ action: "correct", text: e.target.value })} />
                  </label>
                </div>
              );
            })}
          </div>
          {built.diagrams.length > 0 && (
            <div className="card flat">
              <div className="label">Diagrams we spotted</div>
              {built.diagrams.map((dg, i) => (
                <label key={i} className="field" style={{ marginTop: 8 }}>
                  <span className="small">{dg.description}</span>
                  <input className="input" placeholder="Add or fix the caption (optional)" value={captions[i]} onChange={(e) => setCaptions((c) => c.map((x, k) => (k === i ? e.target.value : x)))} />
                </label>
              ))}
            </div>
          )}
          {err && <div className="error-box" role="alert">{err}</div>}
          <button className="btn ink lg" onClick={go} disabled={busy || done < pending.length}>
            {done < pending.length ? `Resolve ${pending.length - done} more line${pending.length - done === 1 ? "" : "s"}` : "Confirm transcript"}
          </button>
        </div>
      </div>
    </div>
  );
}
