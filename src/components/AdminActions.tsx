"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "./api";

function useAct() {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (path: string, body: unknown, ok = "Done.") => {
    setBusy(true);
    setMsg(null);
    try {
      await api(path, { body });
      setMsg(ok);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Failed.");
    }
    setBusy(false);
  };
  return { msg, busy, act };
}

export function ReviewButtons({ id, status }: { id: string; status: string }) {
  const { msg, busy, act } = useAct();
  return (
    <div className="row" style={{ gap: 6 }}>
      {status !== "approved" && <button className="btn sm mint" disabled={busy} onClick={() => act(`/api/admin/questions/${id}/review`, { decision: "approve" }, "Approved.")}>Approve</button>}
      {status === "approved" && <button className="btn sm ghost" disabled={busy} onClick={() => act(`/api/admin/questions/${id}/review`, { decision: "reopen" })}>Reopen</button>}
      {status !== "draft" && <button className="btn sm ghost" disabled={busy} onClick={() => act(`/api/admin/questions/${id}/review`, { decision: "reject" })}>Send back</button>}
      {status !== "retired" && <button className="btn sm ghost" disabled={busy} onClick={() => act(`/api/admin/questions/${id}/review`, { decision: "retire" })}>Retire</button>}
      {msg && <span className="tiny">{msg}</span>}
    </div>
  );
}

export function QotdForm({ examCode, options }: { examCode: string; options: { id: string; text: string }[] }) {
  const { msg, busy, act } = useAct();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [q, setQ] = useState(options[0]?.id ?? "");
  if (!options.length) return <p className="small muted">Approve at least one question first — only human-approved questions can be scheduled.</p>;
  return (
    <div className="row">
      <input type="date" className="input" style={{ width: 180 }} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
      <select className="select" style={{ flex: 1, minWidth: 240 }} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Question">
        {options.map((o) => <option key={o.id} value={o.id}>{o.text.slice(0, 110)}</option>)}
      </select>
      <button className="btn" disabled={busy} onClick={() => act("/api/admin/qotd", { exam_code: examCode, date, question_id: q }, "Scheduled.")}>Schedule</button>
      {msg && <span className="small">{msg}</span>}
    </div>
  );
}

export function GenerateForm({ sources, papers }: { sources: { id: string; title: string }[]; papers: { code: string; name: string }[] }) {
  const { msg, busy, act } = useAct();
  const [s, setS] = useState(sources[0]?.id ?? "");
  const [p, setP] = useState(papers[0]?.code ?? "");
  return (
    <div className="row">
      <select className="select" style={{ flex: 1, minWidth: 220 }} value={s} onChange={(e) => setS(e.target.value)} aria-label="Source">{sources.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select>
      <select className="select" style={{ width: 220 }} value={p} onChange={(e) => setP(e.target.value)} aria-label="Paper">{papers.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select>
      <button className="btn" disabled={busy} onClick={() => act("/api/admin/generate", { source_id: s, paper_code: p, count: 2 }, "Drafts created — review them below.")}>{busy ? "Drafting…" : "Draft questions"}</button>
      {msg && <span className="small">{msg}</span>}
    </div>
  );
}

export function DisputeResolver({ id }: { id: string }) {
  const { msg, busy, act } = useAct();
  const [detail, setDetail] = useState<{ question: string; answer: string; comment: { message: string; evidence: { answer_spans: { quote: string }[] } } | null } | null>(null);
  const [text, setText] = useState("");
  return (
    <div className="stack" style={{ ["--gap" as string]: "8px" }}>
      {!detail ? (
        <button className="btn sm ghost" onClick={async () => setDetail(await api(`/api/admin/disputes/${id}`))}>Open (logged in audit trail)</button>
      ) : (
        <>
          <p className="small"><strong>Q:</strong> {detail.question}</p>
          {detail.comment && <p className="small"><strong>Comment:</strong> {detail.comment.message} <em>“{detail.comment.evidence.answer_spans[0]?.quote}”</em></p>}
          <details><summary className="small">Student answer</summary><p className="small answer-text">{detail.answer}</p></details>
          <textarea className="textarea" style={{ minHeight: 60 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Resolution note shown to the student" />
          <div className="row">
            {(["upheld", "partially_upheld", "overturned"] as const).map((s) => (
              <button key={s} className="btn sm" disabled={busy || text.trim().length < 5} onClick={() => act(`/api/admin/disputes/${id}`, { status: s, resolution: text })}>{s.replace("_", " ")}</button>
            ))}
          </div>
        </>
      )}
      {msg && <span className="tiny">{msg}</span>}
    </div>
  );
}

export function VerifySource({ id, verified }: { id: string; verified: boolean }) {
  const { msg, busy, act } = useAct();
  return (
    <span className="row" style={{ gap: 6 }}>
      <button className="btn sm ghost" disabled={busy} onClick={() => act(`/api/admin/sources/${id}`, { verified: !verified })}>{verified ? "Mark unverified" : "Mark verified"}</button>
      {msg && <span className="tiny">{msg}</span>}
    </span>
  );
}

export function ActivateRubric({ id }: { id: string }) {
  const { msg, busy, act } = useAct();
  return (
    <span className="row" style={{ gap: 6 }}>
      <button className="btn sm ghost" disabled={busy} onClick={() => act(`/api/admin/rubrics/${id}/activate`, {}, "Activated.")}>Activate</button>
      {msg && <span className="tiny">{msg}</span>}
    </span>
  );
}
