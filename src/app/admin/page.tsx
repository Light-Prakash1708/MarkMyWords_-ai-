import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { currentUser } from "@/lib/http";
import { auditLog, costDashboard, listDisputes, listRubricVersions, listSources, reviewQueue } from "@/lib/services/admin";
import { paperSummaries } from "@/lib/services/questions";
import { ActivateRubric, DisputeResolver, GenerateForm, ProviderCheck, QotdForm, ReviewButtons, VerifySource } from "@/components/AdminActions";
import { ReviewBadge } from "@/components/QuestionBits";

export const metadata = { title: "Review desk" };
export const dynamic = "force-dynamic";

const TABS = ["review", "qotd", "disputes", "sources", "rubrics", "costs", "audit"] as const;

export default async function Admin({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role === "student") redirect("/today");
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as (typeof TABS)[number]) : "review";
  const db = (await getDb());
  return (
    <div className="page container">
      <span className="ink-label">Review desk · {user.role}</span>
      <h1 className="h1" style={{ margin: "12px 0 16px" }}>Humans in the loop</h1>
      <nav className="tabs" aria-label="Admin sections" style={{ marginBottom: 20 }}>
        {TABS.map((t) => <Link key={t} href={`/admin?tab=${t}`} className={`btn sm ${tab === t ? "ink" : "ghost"}`}>{t}</Link>)}
      </nav>

      {tab === "review" && (
        <div className="stack">
          {(await reviewQueue(db)).map((q) => (
            <div key={q.id} className="card flat">
              <div className="row between"><span className="label">{q.paper_code} · {q.question_type_code} · {q.origin}</span><ReviewBadge status={q.review_status} /></div>
              <p style={{ fontWeight: 650 }}>{q.text}</p>
              <p className="small muted">Parts: {q.parts.map((p) => p.demand).join(" | ")}</p>
              <p className="small muted">Priority reasons: {q.priority_reasons.join(" · ")}</p>
              {!q.checks.ok && <div className="note-box small">Automated checks: {q.checks.issues.join(" ")}</div>}
              <ReviewButtons id={q.id} status={q.review_status} />
            </div>
          ))}
        </div>
      )}

      {tab === "qotd" && (await (async () => {
        const papers = (await paperSummaries(db, null)).filter((p) => p.exam_status === "active" && p.paper_status === "active");
        const examCode = papers[0]?.exam_code ?? "";
        const approved = (await reviewQueue(db)).filter((q) => q.review_status === "approved").map((q) => ({ id: q.id, text: q.text }));
        const sources = (await listSources(db)).map((s) => ({ id: s.id, title: s.title }));
        const upcoming = (await db.all("SELECT q.date, qu.text FROM qotd q JOIN questions qu ON qu.id = q.question_id ORDER BY q.date DESC LIMIT 14")) as { date: string; text: string }[];
        return (
          <div className="stack">
            <section className="card"><h2 className="h3">Schedule the question of the day</h2><QotdForm examCode={examCode} options={approved} /></section>
            <section className="card"><h2 className="h3">Draft questions from an official source</h2><p className="small muted">Drafts go into the review queue with automated checks (banned phrasing, duplicates, syllabus fit). Requires an AI provider.</p><GenerateForm sources={sources} papers={papers.map((p) => ({ code: p.code, name: p.name }))} /></section>
            <section className="card"><h2 className="h3">Scheduled</h2><ul className="small">{upcoming.map((u) => <li key={u.date}><span className="mono">{u.date}</span> — {u.text.slice(0, 100)}</li>)}</ul>{!upcoming.length && <p className="small muted">Nothing scheduled — a deterministic pick is used each day.</p>}</section>
          </div>
        );
      })())}

      {tab === "disputes" && (
        <div className="stack">
          {(await listDisputes(db)).map((d) => (
            <div key={d.id} className="card flat">
              <div className="row between"><span className="label">{d.student_name} · comment {d.comment_id ?? "(overall)"} · {new Date(d.created_at).toLocaleString("en-IN")}</span><span className={`chip ${d.status === "open" ? "butter" : "mint"}`}>{d.status}</span></div>
              <p>{d.reason}</p>
              {d.status === "open" ? <DisputeResolver id={d.id} /> : <p className="small muted">{d.resolution}</p>}
            </div>
          ))}
          {!(await listDisputes(db)).length && <p className="muted">No disputes.</p>}
        </div>
      )}

      {tab === "sources" && (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Source</th><th>Kind</th><th>Status</th><th></th></tr></thead>
            <tbody>{(await listSources(db)).map((s) => (
              <tr key={s.id}><td><a href={s.url} target="_blank" rel="noreferrer noopener">{s.title}</a><div className="tiny muted">{s.publisher}</div></td><td className="small">{s.text_kind}</td><td><span className={`chip ${s.verification_status === "verified" ? "mint" : "butter"}`}>{s.verification_status}</span></td><td><VerifySource id={s.id} verified={s.verification_status === "verified"} /></td></tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {tab === "rubrics" && (
        <div className="stack">
          <p className="small muted">A rubric version can be activated only with a calibration report covering at least 50 human-reviewed answers. Active versions are immutable; changes require a new version.</p>
          <div className="table-wrap"><table className="t"><thead><tr><th>Rubric</th><th>Version</th><th>Status</th><th>Calibration</th><th></th></tr></thead>
            <tbody>{(await listRubricVersions(db)).map((r) => (
              <tr key={r.id}><td className="mono small">{r.code}</td><td className="mono">{r.version}</td><td>{r.status}</td><td className="small">{r.calibration_report_id ? `${r.human_cases} human-reviewed cases` : "none attached"}</td><td>{r.status !== "active" && <ActivateRubric id={r.id} />}</td></tr>
            ))}</tbody></table></div>
        </div>
      )}

      {tab === "costs" && (await (async () => {
        const c = (await costDashboard(db));
        return (
          <div className="stack">
            <ProviderCheck />
            <dl className="spec">
              <div><dt>Today (est.)</dt><dd>₹{c.today_inr.toFixed(2)} / ₹{c.cap_inr}</dd></div>
              <div><dt>Evaluations</dt><dd>{c.evaluations_total} ({c.evaluations_ai} AI)</dd></div>
              <div><dt>P50 per AI eval</dt><dd>₹{c.per_eval_p50.toFixed(2)}</dd></div>
              <div><dt>P95 per AI eval</dt><dd>₹{c.per_eval_p95.toFixed(2)}</dd></div>
            </dl>
            <p className="tiny muted">{c.pricing_note}</p>
            <div className="table-wrap"><table className="t"><thead><tr><th>Operation</th><th>Calls</th><th>Tokens in</th><th>Tokens out</th><th>₹ est.</th></tr></thead>
              <tbody>{c.by_operation.map((o) => <tr key={o.operation}><td>{o.operation}</td><td className="mono">{o.n}</td><td className="mono">{o.tin}</td><td className="mono">{o.tout}</td><td className="mono">{o.inr.toFixed(2)}</td></tr>)}</tbody></table></div>
            <p className="small">Disputes: {c.disputes.map((d) => `${d.n} ${d.status}`).join(", ") || "none"}</p>
          </div>
        );
      })())}

      {tab === "audit" && (
        <div className="table-wrap"><table className="t"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Reason</th></tr></thead>
          <tbody>{(await auditLog(db)).map((a) => <tr key={a.id}><td className="mono small">{new Date(a.created_at).toLocaleString("en-IN")}</td><td>{a.actor_name ?? "—"}</td><td>{a.action}</td><td className="small">{a.target_type} {a.target_id?.slice(0, 8)}</td><td className="small">{a.reason}</td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}
