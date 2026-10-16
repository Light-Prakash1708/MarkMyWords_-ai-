"use client";
import { useState } from "react";
import { api, ApiError } from "../api";

interface Rung { rung: number; title: string; blurb: string; revealed: boolean; available: boolean; locked_reason: string | null; unlocks_at: string | null }
interface Content { rung: number; generator: string; content: unknown }

function RungBody({ c }: { c: Content }) {
  const x = c.content as Record<string, unknown>;
  if (c.rung === 0) {
    const ps = (x.priorities as { comment_id: string; message: string; quote: string | null }[]) ?? [];
    return <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>{ps.map((p) => <li key={p.comment_id}>{p.message}</li>)}</ol>;
  }
  if (c.rung === 1) {
    const hs = (x.hints as { comment_id: string; nudge: string }[]) ?? [];
    return <ul style={{ margin: 0, paddingLeft: 18 }}>{hs.map((h) => <li key={h.comment_id} style={{ marginBottom: 6 }}>{h.nudge}</li>)}</ul>;
  }
  if (c.rung === 2) {
    const ss = (x.sections as { heading: string; prompts: string[] }[]) ?? [];
    return (
      <div className="stack" style={{ ["--gap" as string]: "8px" }}>
        <p className="tiny muted" style={{ margin: 0 }}>{x.note as string}</p>
        {ss.map((s) => (
          <div key={s.heading} className="note-box">
            <strong>{s.heading}</strong>
            <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>{s.prompts.map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
        ))}
      </div>
    );
  }
  if (c.rung === 3) {
    const items = (x.items as { title: string; url: string; text: string; text_kind: string; verification_status: string }[]) ?? [];
    return (
      <div className="stack" style={{ ["--gap" as string]: "8px" }}>
        {items.map((s) => (
          <div key={s.title + s.text.slice(0, 20)} className="note-box small">
            <div className="row between"><strong>{s.title}</strong><span className="chip">{s.text_kind === "verbatim" ? "verbatim" : "our summary"} · {s.verification_status}</span></div>
            <p style={{ margin: "6px 0" }}>{s.text}</p>
            <a href={s.url} target="_blank" rel="noreferrer noopener" className="tiny">Official reference ↗</a>
          </div>
        ))}
        {!items.length && <p className="small muted">No sources matched these gaps yet.</p>}
      </div>
    );
  }
  if (x.unavailable) return <p className="small muted" style={{ margin: 0 }}>{x.message as string}</p>;
  return (
    <div className="stack" style={{ ["--gap" as string]: "8px" }}>
      <span className="chip butter">{x.label as string}</span>
      <div className="sheet" style={{ ["--lh" as string]: "1.9rem" }}><div className="answer-text">{x.text as string}</div></div>
      {((x.warnings as string[]) ?? []).map((w) => <p key={w} className="tiny">{w}</p>)}
      <p className="tiny muted">Read it, close it, then write your own version. Copying it teaches the transcript, not the skill.</p>
    </div>
  );
}

export function HintLadder({ attemptId, initial }: { attemptId: string; initial: { rungs: Rung[]; contents: Content[]; ai_available: boolean } }) {
  const [rungs, setRungs] = useState(initial.rungs);
  const [contents, setContents] = useState(initial.contents);
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirm5, setConfirm5] = useState(false);

  async function open(rung: number) {
    setBusy(rung);
    setErr(null);
    try {
      const r = await api<{ ladder: { rungs: Rung[]; contents: Content[] } }>(`/api/attempts/${attemptId}/hints`, { body: { rung, confirm: rung === 5 ? confirm5 : undefined } });
      setRungs(r.ladder.rungs);
      setContents(r.ladder.contents);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not open this step.");
    }
    setBusy(null);
  }

  return (
    <section className="card" id="ladder" aria-labelledby="ladder-h">
      <div className="row between">
        <h2 id="ladder-h" className="h2">The hint ladder</h2>
        <span className="chip">Climb only as far as you need</span>
      </div>
      <p className="small muted">Each step gives a little more help. Improvements you make on the lower steps are the ones that stick.</p>
      <div className="ladder" style={{ marginTop: 14 }}>
        {rungs.map((r) => {
          const c = contents.find((x) => x.rung === r.rung);
          const state = r.revealed ? "revealed" : r.available ? "available" : "locked";
          return (
            <div key={r.rung} className={`rung ${state}`}>
              <div className="rung-num" aria-hidden="true">{r.revealed ? "✓" : r.available ? r.rung : "🔒"}</div>
              <div className="stack" style={{ ["--gap" as string]: "8px" }}>
                <div className="row between">
                  <div>
                    <strong>{r.rung}. {r.title}</strong>
                    <div className="small muted">{r.blurb}</div>
                  </div>
                  {!r.revealed && (
                    <div className="row">
                      {r.rung === 5 && r.available && (
                        <label className="tiny row" style={{ gap: 6 }}>
                          <input type="checkbox" checked={confirm5} onChange={(e) => setConfirm5(e.target.checked)} /> I have tried my own rewrite
                        </label>
                      )}
                      <button className="btn sm" disabled={!r.available || busy !== null || (r.rung === 5 && !confirm5)} onClick={() => open(r.rung)}>
                        {busy === r.rung ? "Opening…" : "Open"}
                      </button>
                    </div>
                  )}
                </div>
                {!r.revealed && !r.available && r.locked_reason && <p className="tiny muted" style={{ margin: 0 }}>{r.locked_reason}{r.unlocks_at ? ` (unlocks ${new Date(r.unlocks_at).toLocaleTimeString("en-IN", { timeStyle: "short" })})` : ""}</p>}
                {r.revealed && c && <RungBody c={c} />}
              </div>
            </div>
          );
        })}
      </div>
      {err && <div className="error-box" role="alert" style={{ marginTop: 12 }}>{err}</div>}
      {!initial.ai_available && <p className="tiny muted" style={{ marginTop: 12 }}>Steps 4–5 need an AI provider; steps 0–3 work in demo mode.</p>}
    </section>
  );
}
