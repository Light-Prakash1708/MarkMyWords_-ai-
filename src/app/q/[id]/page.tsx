import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { currentUser } from "@/lib/http";
import { directivesFor, getDossier, getPracticableQuestion, syllabusTitles } from "@/lib/services/questions";
import { enabledCriteria, rubricForQuestion } from "@/lib/services/evaluations";
import { dueRetests } from "@/lib/services/skills";
import { AppError } from "@/lib/util/errors";
import { QuestionMeta, ReviewBadge } from "@/components/QuestionBits";
import { StartAttempt } from "@/components/StartAttempt";

export const dynamic = "force-dynamic";

export default async function QuestionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const db = getDb();
  let q;
  try {
    q = getPracticableQuestion(db, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const directives = directivesFor(db, q.directive_codes);
  const syl = syllabusTitles(db, q.syllabus_codes);
  const dossier = getDossier(db, user.id, q.id);
  const rv = rubricForQuestion(db, q);
  const prior = db.prepare("SELECT id, status, attempt_kind, created_at FROM attempts WHERE user_id = ? AND question_id = ? ORDER BY created_at DESC").all(user.id, q.id) as { id: string; status: string; attempt_kind: string; created_at: string }[];
  const retest = dueRetests(db, user.id).find((r) => r.question_id === q.id && r.is_due);
  return (
    <div className="page container">
      <Link href="/practice" className="small">← Question bank</Link>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))", marginTop: 14, alignItems: "start" }}>
        <div className="stack">
          <div className="signboard reveal" style={{ textAlign: "left" }}>
            <div className="row between"><span className="label" style={{ color: "rgba(23,20,17,.7)" }}>{q.exam_name} · {q.paper_name}</span><ReviewBadge status={q.review_status} /></div>
            <h1 style={{ fontSize: "clamp(1.3rem, 3vw, 1.8rem)", fontWeight: 750, lineHeight: 1.3, margin: "12px 0" }}>{q.text}</h1>
            <QuestionMeta q={q} />
          </div>
          <div className="card reveal" style={{ ["--d" as string]: 1 }}>
            <div className="label">What the question asks</div>
            <ol style={{ margin: "8px 0 0", paddingLeft: 20, display: "grid", gap: 6 }}>
              {q.parts.map((p) => <li key={p.id}>{p.demand}</li>)}
            </ol>
            <hr className="dash" />
            {directives.map((d) => (
              <p key={d.code} style={{ margin: "0 0 6px" }}><span className="chip butter">{d.label}</span> {d.demand}</p>
            ))}
          </div>
          <div className="card pastel bg-paper2 reveal" style={{ ["--d" as string]: 2 }}>
            <div className="label">Why this topic matters</div>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {q.priority_reasons.map((r) => <li key={r}>{r}</li>)}
              {q.syllabus_codes.map((c) => syl[c] && <li key={c}>Syllabus: {syl[c]}</li>)}
            </ul>
            <p className="tiny muted" style={{ marginBottom: 0 }}>These are reasons for practising it, not a claim that it will be asked.</p>
          </div>
          {!dossier.locked && dossier.items.length > 0 && (
            <details className="card reveal">
              <summary style={{ fontWeight: 750 }}>Background dossier ({dossier.items.length}) — optional reading before you write</summary>
              <div className="stack" style={{ marginTop: 12 }}>
                {dossier.items.map((s) => (
                  <div key={s.id} className="note-box">
                    <div className="row between"><strong>{s.title}</strong><span className="chip">{s.text_kind === "verbatim" ? "Verbatim" : "Our summary"} · {s.verification_status}</span></div>
                    <p className="small" style={{ whiteSpace: "pre-wrap" }}>{s.text}</p>
                    <a className="tiny" href={s.url} target="_blank" rel="noreferrer noopener">Official reference ↗</a>
                  </div>
                ))}
              </div>
            </details>
          )}
          {dossier.locked && <p className="small muted">A source dossier for this question unlocks after your attempt.</p>}
        </div>
        <div className="stack" style={{ position: "sticky", top: 84 }}>
          <div className="card reveal">
            <h2 className="h3" style={{ marginBottom: 12 }}>{retest ? "Transfer check" : "Your attempt"}</h2>
            {retest && <p className="small">This question checks whether your work on <strong>{retest.skill_name}</strong> holds on a fresh question. No hints before you submit.</p>}
            <StartAttempt questionId={q.id} modes={q.input_modes} defaultMode={q.default_input_mode} timeBudget={q.time_budget_min} retestId={retest?.id} />
          </div>
          <div className="card flat reveal">
            <div className="label">You will be assessed on</div>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }} className="small">
              {enabledCriteria(rv, q.default_input_mode).map((c) => <li key={c.code}>{c.name}</li>)}
            </ul>
            <p className="tiny muted" style={{ marginBottom: 0 }}>Rubric {rv.rubric_code} v{rv.version} · {rv.status}. <Link href="/how-we-evaluate">How we mark</Link></p>
          </div>
          {prior.length > 0 && (
            <div className="card flat">
              <div className="label">Your attempts at this question</div>
              <ul style={{ margin: "8px 0 0", paddingLeft: 0, listStyle: "none", display: "grid", gap: 6 }}>
                {prior.map((a) => (
                  <li key={a.id}><Link href={`/attempt/${a.id}`}>{new Date(a.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</Link> · {a.attempt_kind.replace("_", " ")} · {a.status.replace(/_/g, " ")}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
