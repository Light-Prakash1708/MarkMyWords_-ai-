import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { currentUser } from "@/lib/http";
import { DISCLAIMER, HEURISTIC_NOTICE } from "@/lib/copy/disclaimer";
import { getProvider } from "@/lib/llm";
import { signedUploadUrl } from "@/lib/security/signing";
import { getOwnedAttempt, getSelfAssessment, latestOcr, latestTranscript, listUploads } from "@/lib/services/attempts";
import { enabledCriteria, getRubricVersion, latestEvaluation, listDisputesForUser, rubricForQuestion } from "@/lib/services/evaluations";
import { getLadder } from "@/lib/services/hints";
import { hasPendingJobs, kickJobs } from "@/lib/services/jobs";
import { isGuest } from "@/lib/services/trial";
import { getQuestion } from "@/lib/services/questions";
import { AppError } from "@/lib/util/errors";
import { QuestionMeta } from "@/components/QuestionBits";
import { TypedEditor } from "@/components/attempt/TypedEditor";
import { HandwrittenUploader } from "@/components/attempt/HandwrittenUploader";
import { ConfirmTranscript, ManualTranscribe, PenSpinner, Poller } from "@/components/attempt/Transcription";
import { SelfAssess } from "@/components/attempt/SelfAssess";
import { Report } from "@/components/attempt/Report";
import { HintLadder } from "@/components/attempt/HintLadder";

export const dynamic = "force-dynamic";
// Evaluation and OCR run after the response (see lib/services/jobs.ts); give them room on serverless.
export const maxDuration = 300;
export const metadata = { title: "Your attempt" };

const STEPS = ["Write", "Transcript", "Self-check", "Feedback", "Repair"];

function Steps({ at }: { at: number }) {
  return (
    <ol className="row" style={{ listStyle: "none", padding: 0, margin: "0 0 18px", gap: 6 }} aria-label="Progress">
      {STEPS.map((s, i) => (
        <li key={s} className={`chip ${i < at ? "mint" : i === at ? "butter" : ""}`} aria-current={i === at ? "step" : undefined}>
          {i < at ? "✓ " : ""}{s}
        </li>
      ))}
    </ol>
  );
}

export default async function AttemptPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const db = (await getDb());
  let a;
  try {
    a = (await getOwnedAttempt(db, user.id, id));
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const env = getEnv();
  const q = (await getQuestion(db, a.question_id));
  const tr = (await latestTranscript(db, a.id));
  const uploads = (await listUploads(db, user.id, a.id)).map((u) => ({ ...u, url: signedUploadUrl(u.id) }));
  const ev = (await latestEvaluation(db, a.id));
  const rv = ev ? (await getRubricVersion(db, ((await db.get("SELECT rubric_version_id FROM evaluations WHERE id = ?", ev.id)) as { rubric_version_id: string }).rubric_version_id)) : (await rubricForQuestion(db, q));
  const crit = enabledCriteria(rv, a.mode);
  const aiAvailable = !!getProvider();
  // While the page polls during transcription/evaluation, make sure queued work keeps moving.
  if (await hasPendingJobs(db)) kickJobs(db);

  let body: React.ReactNode;
  let step = 0;
  if (a.status === "draft") {
    step = 0;
    body =
      a.mode === "typed" ? (
        <TypedEditor
          attemptId={a.id}
          initialText={a.draft_text}
          startedAt={a.started_at}
          timerMode={a.timer_mode}
          timeBudgetMin={q.time_budget_min}
          wordLimit={q.word_limit}
          editorStyle={q.ux.editor_style}
          showTypingSpeed={q.ux.show_typing_speed}
          isRewrite={a.attempt_kind === "rewrite"}
        />
      ) : (
        <HandwrittenUploader attemptId={a.id} uploads={uploads} startedAt={a.started_at} />
      );
  } else if (a.status === "awaiting_transcription") {
    step = 1;
    const ocr = (await latestOcr(db, a.id));
    const pendingJob = (await db.get("SELECT 1 FROM jobs WHERE kind = 'ocr' AND status IN ('queued','running') AND payload LIKE ?", `%${a.id}%`));
    if (env.ocrProvider === "manual" || (ocr && ocr.status === "failed" && !pendingJob)) {
      body = (
        <ManualTranscribe
          attemptId={a.id}
          reason={env.ocrProvider === "manual" ? "Automatic handwriting reading needs an AI provider, which is not configured." : "We could not read your pages automatically."}
        />
      );
    } else {
      body = (
        <>
          <Poller />
          <PenSpinner label="Reading your handwriting…" />
        </>
      );
    }
  } else if (a.status === "awaiting_confirmation") {
    step = 1;
    const ocr = (await latestOcr(db, a.id));
    body = ocr?.built ? <ConfirmTranscript attemptId={a.id} built={ocr.built} uploads={uploads} /> : <PenSpinner label="Preparing your transcript…" />;
  } else if (a.status === "ready") {
    step = 2;
    const failed = ev?.status === "failed" ? ev.error : null;
    body = (
      <>
        {failed && <div className="error-box" style={{ marginBottom: 14 }}>The last evaluation attempt failed ({failed}). Your answer is safe — try again.</div>}
        <SelfAssess attemptId={a.id} criteria={crit} maxBand={rv.max_band} existing={(await getSelfAssessment(db, a.id))?.ratings ?? null} aiAvailable={aiAvailable} />
      </>
    );
  } else if (a.status === "evaluating") {
    step = 3;
    body = (
      <>
        <Poller />
        <PenSpinner label={aiAvailable ? "Marking your answer — three independent passes, then checks…" : "Marking your answer…"} />
      </>
    );
  } else if (a.status === "evaluated" && ev?.result) {
    step = 4;
    const disputes = (await listDisputesForUser(db, user.id, ev.id));
    const retest = (await db.get(`SELECT r.id, r.due_at, s.name AS skill_name, q.slug AS question_slug FROM retest_schedule r JOIN skill_tags s ON s.code = r.skill_tag LEFT JOIN questions q ON q.id = r.question_id
         WHERE r.source_attempt_id = ? AND r.status = 'scheduled' ORDER BY r.due_at LIMIT 1`, a.id)) as { id: string; due_at: string; skill_name: string; question_slug: string } | undefined;
    body = (
      <div className="stack" style={{ ["--gap" as string]: "26px" }}>
        <Report
          evaluationId={ev.id}
          attemptId={a.id}
          attemptKind={a.attempt_kind}
          questionId={q.id}
          questionSlug={q.slug}
          result={ev.result}
          text={tr?.text ?? ""}
          uncertain={tr?.uncertain_spans ?? []}
          disclaimer={DISCLAIMER}
          disputes={disputes}
          retestOffer={retest ?? null}
          heuristicNotice={ev.result.evaluator.is_ai ? null : HEURISTIC_NOTICE}
        />
        <HintLadder attemptId={a.id} initial={await getLadder(db, user.id, a.id)} />
      </div>
    );
  } else {
    body = <div className="error-box">This attempt is in an unexpected state ({a.status}).</div>;
  }

  return (
    <div className="page container">
      {isGuest(user) && (
        <div className="note-box row between small" style={{ marginBottom: 12, gap: 10 }}>
          <span>Guest trial: this answer is private and kept for a limited time.{a.status === "evaluated" ? " Like the feedback? Save it to your own account." : ""}</span>
          <span className="row" style={{ gap: 8 }}>
            <Link className="btn sm ghost" href="/try">All trial questions</Link>
            <Link className="btn sm" href="/signup">Save my work</Link>
          </span>
        </div>
      )}
      <div className="row between" style={{ marginBottom: 10 }}>
        <Link href={isGuest(user) ? "/try" : `/q/${q.slug}`} className="small">{isGuest(user) ? "← Trial questions" : "← Question"}</Link>
        <span className="chip">{a.attempt_kind === "first" ? "First attempt" : a.attempt_kind === "rewrite" ? "Rewrite" : "Transfer check"} · {a.mode}</span>
      </div>
      <details className="card flat bg-paper2" style={{ marginBottom: 18 }} open={a.status === "draft"}>
        <summary style={{ fontWeight: 700 }}>{q.text}</summary>
        <div style={{ marginTop: 10 }}>
          <QuestionMeta q={q} />
          <ol className="small" style={{ margin: "10px 0 0", paddingLeft: 20 }}>
            {q.parts.map((p) => <li key={p.id}>{p.demand}</li>)}
          </ol>
        </div>
      </details>
      <Steps at={step} />
      {a.parent_attempt_id && (
        <p className="small" style={{ marginTop: -6 }}>
          Rewrite of <Link href={`/attempt/${a.parent_attempt_id}`}>your earlier attempt</Link>.
        </p>
      )}
      {body}
    </div>
  );
}
