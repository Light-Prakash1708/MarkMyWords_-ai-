"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";

function countWords(s: string) {
  const m = s.trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’\-./%]*/gu);
  return m ? m.length : 0;
}
function fmt(sec: number) {
  const s = Math.abs(sec);
  return `${sec < 0 ? "+" : ""}${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function TypedEditor(props: {
  attemptId: string;
  initialText: string;
  startedAt: string;
  timerMode: "exam" | "untimed";
  timeBudgetMin: number;
  wordLimit: number | null;
  editorStyle: string;
  showTypingSpeed: boolean;
  isRewrite: boolean;
}) {
  const router = useRouter();
  const storageKey = `mmw-draft-${props.attemptId}`;
  const [text, setText] = useState(props.initialText);
  const [saved, setSaved] = useState<"saved" | "saving" | "unsaved" | "offline">("saved");
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstKey = useRef<number | null>(null);

  useEffect(() => {
    try {
      const local = localStorage.getItem(storageKey);
      if (local && local.length > props.initialText.length) setText(local);
    } catch {}
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [storageKey, props.initialText]);

  const save = useCallback(
    async (value: string) => {
      setSaved("saving");
      try {
        await api(`/api/attempts/${props.attemptId}`, { method: "PATCH", body: { draft_text: value } });
        setSaved("saved");
      } catch {
        setSaved("offline");
      }
    },
    [props.attemptId],
  );

  function onChange(v: string) {
    if (firstKey.current === null) firstKey.current = Date.now();
    setText(v);
    setSaved("unsaved");
    try {
      localStorage.setItem(storageKey, v);
    } catch {}
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(v), 1500);
  }

  const elapsed = Math.floor((now - new Date(props.startedAt).getTime()) / 1000);
  const remaining = props.timeBudgetMin * 60 - elapsed;
  const words = countWords(text);
  const limit = props.wordLimit;
  const pct = limit ? Math.min(1.3, words / limit) : 0;
  const zone = !limit ? "var(--sky)" : words > limit * 1.15 ? "var(--coral)" : words >= limit * 0.6 ? "var(--mint)" : "var(--butter)";
  const typingMins = firstKey.current ? (now - firstKey.current) / 60000 : 0;
  const wpm = typingMins > 0.2 ? Math.round(words / typingMins) : null;

  const [confirming, setConfirming] = useState(false);
  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      if (timer.current) clearTimeout(timer.current);
      await api(`/api/attempts/${props.attemptId}/submit`, { body: { text, time_spent_sec: Math.max(0, elapsed) } });
      try {
        localStorage.removeItem(storageKey);
      } catch {}
      router.refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not submit.");
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="card flat row between" style={{ position: "sticky", top: 70, zIndex: 5, padding: "10px 14px" }}>
        <div className="row" style={{ gap: 18 }}>
          {props.timerMode === "exam" ? (
            <div>
              <div className="label">{remaining >= 0 ? "Time left" : "Over time"}</div>
              <div className={`timer${remaining < 0 ? " over" : ""}`} aria-live="off">{fmt(remaining)}</div>
            </div>
          ) : (
            <div>
              <div className="label">Elapsed</div>
              <div className="timer">{fmt(elapsed)}</div>
            </div>
          )}
          <div style={{ minWidth: 160 }}>
            <div className="label">Words {limit ? `· limit ~${limit}` : ""}</div>
            <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
              <strong className="mono">{words}</strong>
              {limit && (
                <div className="meter" style={{ flex: 1, minWidth: 90 }} role="img" aria-label={`${words} of about ${limit} words`}>
                  <span style={{ width: `${Math.min(100, pct * 100 / 1.3)}%`, ["--c" as string]: zone, animation: "none" }} />
                </div>
              )}
            </div>
          </div>
          {props.showTypingSpeed && wpm !== null && (
            <div><div className="label">Speed</div><div className="mono">{wpm} wpm</div></div>
          )}
        </div>
        <div className="row">
          <span className="tiny muted" aria-live="polite">{saved === "saved" ? "Saved" : saved === "saving" ? "Saving…" : saved === "offline" ? "Saved on this device" : "Editing"}</span>
          {confirming ? (
            <>
              <button className="btn sm ghost" onClick={() => setConfirming(false)} disabled={busy}>Keep writing</button>
              <button className="btn coral" onClick={submit} disabled={busy}>{busy ? "Submitting…" : "Yes, submit"}</button>
            </>
          ) : (
            <button className="btn ink" onClick={() => setConfirming(true)} disabled={busy || words < 15}>Submit answer</button>
          )}
        </div>
      </div>
      {props.isRewrite && <div className="note-box small">This is a rewrite. Your previous answer is loaded — change what the feedback flagged, without looking at a model answer.</div>}
      <div className={`sheet${props.editorStyle === "exam_terminal" ? " terminal" : ""}`}>
        <label htmlFor="answer" className="sr-only">Your answer</label>
        <textarea id="answer" value={text} onChange={(e) => onChange(e.target.value)} placeholder="Start with a line that frames the question…" spellCheck autoFocus />
      </div>
      {confirming && <div className="note-box small" role="status">Submitting locks this attempt. You can rewrite it after feedback.</div>}
      {err && <div className="error-box" role="alert">{err}</div>}
      <p className="tiny muted">Tip: leave a blank line between paragraphs. Your draft autosaves to the server and to this device.</p>
    </div>
  );
}
