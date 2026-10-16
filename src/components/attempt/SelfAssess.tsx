"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "../api";

interface Crit { code: string; name: string; bands: { band: number; descriptor: string }[] }

export function SelfAssess({ attemptId, criteria, maxBand, existing, aiAvailable }: { attemptId: string; criteria: Crit[]; maxBand: number; existing: { criterion_code: string; band: number }[] | null; aiAvailable: boolean }) {
  const router = useRouter();
  const [vals, setVals] = useState<Record<string, number>>(Object.fromEntries(criteria.map((c) => [c.code, existing?.find((e) => e.criterion_code === c.code)?.band ?? Math.floor(maxBand / 2)])));
  const [conf, setConf] = useState<"low" | "medium" | "high">("medium");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function evaluate(withSelf: boolean) {
    setBusy(true);
    setErr(null);
    try {
      if (withSelf) {
        await api(`/api/attempts/${attemptId}/self-assessment`, { body: { ratings: Object.entries(vals).map(([criterion_code, band]) => ({ criterion_code, band })), confidence: conf } });
      }
      await api(`/api/attempts/${attemptId}/evaluate`, { method: "POST" });
      router.refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not start the evaluation.");
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <div className="card pastel bg-lilac">
        <span className="sticker" style={{ background: "var(--surface)", color: "var(--ink)" }}>30-second self-check</span>
        <h2 className="h3" style={{ marginTop: 12 }}>Before you see feedback: how would you rate your own answer?</h2>
        <p className="small" style={{ marginBottom: 0 }}>Judging your own answer is a skill. We compare your ratings with the estimate over time, so you can see your judgement sharpen.</p>
      </div>
      <div className="card stack">
        {criteria.map((c) => {
          const v = vals[c.code];
          return (
            <div key={c.code} className="field">
              <label htmlFor={`sa-${c.code}`} className="row between"><span>{c.name}</span><span className="chip">{v} / {maxBand}</span></label>
              <input id={`sa-${c.code}`} type="range" min={0} max={maxBand} step={1} value={v} onChange={(e) => setVals((x) => ({ ...x, [c.code]: Number(e.target.value) }))} style={{ accentColor: "var(--red-pen)" }} />
              <span className="tiny muted">{c.bands.find((b) => b.band === v)?.descriptor}</span>
            </div>
          );
        })}
        <div className="row">
          <span className="small" style={{ fontWeight: 650 }}>How sure are you?</span>
          {(["low", "medium", "high"] as const).map((c) => (
            <button key={c} type="button" className={`btn sm ${conf === c ? "ink" : "ghost"}`} onClick={() => setConf(c)} aria-pressed={conf === c}>{c}</button>
          ))}
        </div>
      </div>
      {err && <div className="error-box" role="alert">{err}</div>}
      <div className="row">
        <button className="btn ink lg" onClick={() => evaluate(true)} disabled={busy}>{busy ? "Sending to the marker…" : "Save & get feedback"}</button>
        <button className="btn ghost" onClick={() => evaluate(false)} disabled={busy}>Skip self-check</button>
      </div>
      {!aiAvailable && <p className="tiny muted">Running the rule-based demo evaluator (no AI key configured).</p>}
    </div>
  );
}
