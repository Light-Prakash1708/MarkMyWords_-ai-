"use client";
import { useState } from "react";
import { api, ApiError } from "./api";

const PURPOSES: Record<string, { title: string; body: string }> = {
  benchmark_use: { title: "Use my anonymised answers in quality benchmarks", body: "Helps us measure whether marking is consistent and accurate. Names and emails are never included." },
  model_improvement: { title: "Use my anonymised answers to improve the evaluator", body: "For example, to tune prompts and rubrics. Off unless you switch it on." },
  public_example: { title: "Allow my answer to be shown as an anonymised example", body: "Only with this switched on; you can revoke it any time." },
};

export function ConsentToggles({ initial }: { initial: { purpose: string; granted: number }[] }) {
  const [rows, setRows] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="stack">
      {rows.map((r) => {
        const meta = PURPOSES[r.purpose];
        if (!meta) return null;
        return (
          <label key={r.purpose} className="row between card flat" style={{ padding: 14, flexWrap: "nowrap", alignItems: "flex-start" }}>
            <span>
              <strong>{meta.title}</strong>
              <span className="small muted" style={{ display: "block" }}>{meta.body}</span>
            </span>
            <input
              type="checkbox"
              style={{ width: 22, height: 22, accentColor: "var(--red-pen)" }}
              checked={!!r.granted}
              onChange={async (e) => {
                setErr(null);
                try {
                  const res = await api<{ consents: { purpose: string; granted: number }[] }>("/api/me/consents", { body: { purpose: r.purpose, granted: e.target.checked } });
                  setRows(res.consents);
                } catch (x) {
                  setErr(x instanceof ApiError ? x.message : "Could not save.");
                }
              }}
            />
          </label>
        );
      })}
      {err && <div className="error-box">{err}</div>}
    </div>
  );
}

export function ProfileForm({ name, exam, exams }: { name: string; exam: string | null; exams: { code: string; name: string; status: string }[] }) {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        try {
          await api("/api/me/profile", { body: { display_name: f.get("display_name"), target_exam_code: f.get("target_exam_code") } });
          setMsg("Saved.");
        } catch (x) {
          setMsg(x instanceof ApiError ? x.message : "Could not save.");
        }
      }}
    >
      <div className="field"><label htmlFor="dn">Display name</label><input id="dn" name="display_name" className="input" defaultValue={name} maxLength={60} /></div>
      <div className="field">
        <label htmlFor="ex">Exam</label>
        <select id="ex" name="target_exam_code" className="select" defaultValue={exam ?? undefined}>
          {exams.map((e) => <option key={e.code} value={e.code} disabled={e.status !== "active"}>{e.name}{e.status !== "active" ? " — coming next" : ""}</option>)}
        </select>
      </div>
      <div className="row"><button className="btn" type="submit">Save</button>{msg && <span className="small">{msg}</span>}</div>
    </form>
  );
}

export function DeleteAccount({ email }: { email: string }) {
  const [v, setV] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="stack">
      <p className="small">This permanently deletes your account, answers, uploaded pages, evaluations and progress. It cannot be undone. Download your data first if you want a copy.</p>
      <div className="field">
        <label htmlFor="del">Type <strong>{email}</strong> to confirm</label>
        <input id="del" className="input" value={v} onChange={(e) => setV(e.target.value)} autoComplete="off" />
      </div>
      {err && <div className="error-box">{err}</div>}
      <button
        className="btn coral"
        disabled={v.trim().toLowerCase() !== email}
        onClick={async () => {
          try {
            await api("/api/me/delete", { body: { confirm_email: v } });
            window.location.href = "/";
          } catch (x) {
            setErr(x instanceof ApiError ? x.message : "Could not delete.");
          }
        }}
      >
        Delete my account permanently
      </button>
    </div>
  );
}
