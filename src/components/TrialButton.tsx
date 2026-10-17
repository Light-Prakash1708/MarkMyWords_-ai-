"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "./api";

/** Starts (or reopens) a trial answer; creates a private guest session when needed. */
export function TrialButton({ questionId, label, mode, className = "btn" }: { questionId: string; label: string; mode?: "typed" | "handwritten"; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ msg: string; signup: boolean } | null>(null);
  async function go() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ attempt_id: string }>("/api/trial/attempt", { body: { question_id: questionId, mode } });
      router.push(`/attempt/${r.attempt_id}`);
    } catch (e) {
      setErr({ msg: e instanceof ApiError ? e.message : "Could not start. Please try again.", signup: e instanceof ApiError && (e.code === "SIGNUP_REQUIRED" || e.code === "QUOTA_EXCEEDED") });
      setBusy(false);
    }
  }
  return (
    <div className="stack" style={{ ["--gap" as string]: "6px" }}>
      <button type="button" className={className} onClick={go} disabled={busy}>
        {busy ? "Opening your sheet…" : label}
      </button>
      {err && (
        <p className="tiny" role="alert" style={{ margin: 0 }}>
          {err.msg} {err.signup && <a href="/signup">Create a free account →</a>}
        </p>
      )}
    </div>
  );
}
