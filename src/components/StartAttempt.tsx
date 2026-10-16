"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "./api";

export function StartAttempt({ questionId, modes, defaultMode, timeBudget, retestId }: { questionId: string; modes: ("typed" | "handwritten")[]; defaultMode: "typed" | "handwritten"; timeBudget: number; retestId?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState(modes.includes(defaultMode) ? defaultMode : modes[0]);
  const [timer, setTimer] = useState<"exam" | "untimed">("exam");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function start() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ attempt: { id: string } }>("/api/attempts", {
        body: { question_id: questionId, mode, timer_mode: timer, attempt_kind: retestId ? "transfer_retest" : "first", retest_id: retestId },
      });
      router.push(`/attempt/${r.attempt.id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not start.");
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      {modes.length > 1 && (
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: 8 }}>How will you answer?</legend>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {modes.map((m) => (
              <label key={m} className={`card flat ${mode === m ? "bg-sky pastel" : ""}`} style={{ padding: 14, cursor: "pointer", boxShadow: mode === m ? "var(--shadow-sm)" : "none" }}>
                <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="sr-only" />
                <div style={{ fontWeight: 750 }}>{m === "handwritten" ? "✍️ On paper" : "⌨️ Typed"}</div>
                <div className="tiny">{m === "handwritten" ? "Write on a sheet, then photograph it" : "Write in the exam-style editor"}</div>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <label className="row small" style={{ gap: 8 }}>
        <input type="checkbox" checked={timer === "exam"} onChange={(e) => setTimer(e.target.checked ? "exam" : "untimed")} />
        Exam timing ({timeBudget} min countdown)
      </label>
      {err && <div className="error-box" role="alert">{err}</div>}
      <button className="btn lg ink" onClick={start} disabled={busy} style={{ width: "100%" }}>
        {busy ? "Opening your sheet…" : retestId ? "Start the transfer check" : "Start my attempt"}
      </button>
      <p className="tiny muted">No model answer or outline is shown before you submit. That is the point.</p>
    </div>
  );
}
