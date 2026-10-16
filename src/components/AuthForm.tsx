"use client";
import Link from "next/link";
import { useState } from "react";
import { api, ApiError } from "./api";

export function AuthForm({ mode, exams = [] }: { mode: "login" | "signup"; exams?: { code: string; label: string; active: boolean }[] }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const body = Object.fromEntries(f.entries());
    try {
      await api(`/api/auth/${mode}`, { body });
      window.location.href = mode === "signup" ? "/today?welcome=1" : "/today";
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }
  return (
    <form onSubmit={onSubmit} className="stack" style={{ ["--gap" as string]: "16px" }} noValidate>
      {mode === "signup" && (
        <div className="field">
          <label htmlFor="display_name">What should we call you?</label>
          <input className="input" id="display_name" name="display_name" required maxLength={60} autoComplete="nickname" />
        </div>
      )}
      <div className="field">
        <label htmlFor="email">Email</label>
        <input className="input" id="email" name="email" type="email" required autoComplete="email" />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input className="input" id="password" name="password" type="password" required minLength={mode === "signup" ? 10 : 1} autoComplete={mode === "signup" ? "new-password" : "current-password"} />
        {mode === "signup" && <span className="muted tiny">At least 10 characters. A short phrase works well.</span>}
      </div>
      {mode === "signup" && (
        <div className="field">
          <label htmlFor="target_exam_code">Preparing for</label>
          <select className="select" id="target_exam_code" name="target_exam_code" defaultValue={exams.find((e) => e.active)?.code}>
            {exams.map((e) => (
              <option key={e.code} value={e.code} disabled={!e.active}>
                {e.label}{e.active ? "" : " — coming next"}
              </option>
            ))}
          </select>
        </div>
      )}
      {err && <div className="error-box" role="alert">{err}</div>}
      <button className="btn lg" type="submit" disabled={busy} style={{ width: "100%" }}>
        {busy ? "One moment…" : mode === "signup" ? "Create my account" : "Log in"}
      </button>
      <p className="small muted" style={{ textAlign: "center" }}>
        {mode === "signup" ? (
          <>Already have an account? <Link href="/login">Log in</Link></>
        ) : (
          <>New here? <Link href="/signup">Create a free account</Link></>
        )}
      </p>
      {mode === "signup" && (
        <p className="tiny muted">
          Your answers are private by default. We never use them for benchmarks or model improvement unless you opt in under Settings → Privacy.
        </p>
      )}
    </form>
  );
}
