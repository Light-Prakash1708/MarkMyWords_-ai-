import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { currentUser } from "@/lib/http";
import { listExams, listQuestions, paperSummaries } from "@/lib/services/questions";
import { QuestionCard } from "@/components/QuestionBits";
import { isGuest } from "@/lib/services/trial";

export const metadata = { title: "Practice" };
export const dynamic = "force-dynamic";

export default async function Practice({ searchParams }: { searchParams: Promise<{ paper?: string; exam?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (isGuest(user)) redirect("/try");
  const sp = await searchParams;
  const db = (await getDb());
  const exams = (await listExams(db)).filter((e) => e.status === "active");
  const examCode = exams.find((e) => e.code === sp.exam)?.code ?? exams.find((e) => e.code === user.target_exam_code)?.code ?? exams[0]?.code ?? null;
  const exam = exams.find((e) => e.code === examCode);
  const papers = (await paperSummaries(db, examCode)).filter((p) => p.exam_status === "active" && p.paper_status === "active");
  const paper = papers.find((p) => p.code === sp.paper)?.code;
  const questions = (await listQuestions(db, { examCode, paperCode: paper }));
  const qs = (p?: string) => `/practice?exam=${encodeURIComponent(examCode ?? "")}${p ? `&paper=${encodeURIComponent(p)}` : ""}`;
  const attempted = new Set(((await db.all("SELECT DISTINCT question_id FROM attempts WHERE user_id = ?", user.id)) as { question_id: string }[]).map((r) => r.question_id));
  const current = papers.find((p) => p.code === paper);
  return (
    <div className="page container">
      <div className="label">Question bank</div>
      <h1 className="h1" style={{ margin: "6px 0 16px" }}>Pick a question. <span className="boxed mint">Write.</span></h1>
      {exams.length > 1 && (
        <div className="tabs" role="navigation" aria-label="Choose exam" style={{ marginBottom: 10 }}>
          {exams.map((e) => (
            <Link key={e.code} className={`btn sm ${e.code === examCode ? "ink" : "ghost"}`} href={`/practice?exam=${encodeURIComponent(e.code)}`}>
              {e.short_name}{e.stage === "preview" ? " · preview" : ""}
            </Link>
          ))}
        </div>
      )}
      {exam?.stage === "preview" && (
        <p className="note-box small" style={{ marginBottom: 14 }}>
          {exam.short_name} is in preview: a small question set and a new rubric that has not yet been calibrated against human evaluators. Feedback is still evidence-linked; treat scores as rough estimates.
        </p>
      )}
      <div className="tabs" role="navigation" aria-label="Filter by paper" style={{ marginBottom: 14 }}>
        <Link className={`btn sm ${!paper ? "ink" : "ghost"}`} href={qs()}>All papers</Link>
        {papers.map((p) => (
          <Link key={p.code} className={`btn sm ${paper === p.code ? "ink" : "ghost"}`} href={qs(p.code)}>
            {p.name}
          </Link>
        ))}
      </div>
      {current && (
        <p className="small muted" style={{ marginBottom: 20 }}>
          {current.subtitle}. Paper format: {current.total_marks} marks · {current.duration_min} min —{" "}
          <span title={current.fact_source_url}>{current.verification_status === "official" ? "verified against the official notice" : `checked against a secondary source on ${current.verified_on}; verify with the official notice`}</span>.
        </p>
      )}
      <div className="grid grid-3">
        {questions.map((q, i) => (
          <div key={q.id} className="reveal" style={{ ["--d" as string]: i % 6 }}>
            <QuestionCard q={q} cta={attempted.has(q.id) ? "Practise again" : "Write"} />
          </div>
        ))}
      </div>
      {!questions.length && <p className="muted">No questions available for this paper yet.</p>}
    </div>
  );
}
