import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { currentUser } from "@/lib/http";
import { listQuestions, paperSummaries } from "@/lib/services/questions";
import { QuestionCard } from "@/components/QuestionBits";

export const metadata = { title: "Practice" };
export const dynamic = "force-dynamic";

export default async function Practice({ searchParams }: { searchParams: Promise<{ paper?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const sp = await searchParams;
  const db = getDb();
  const papers = paperSummaries(db, user.target_exam_code).filter((p) => p.exam_status === "active");
  const paper = papers.find((p) => p.code === sp.paper)?.code;
  const questions = listQuestions(db, { examCode: user.target_exam_code, paperCode: paper });
  const attempted = new Set((db.prepare("SELECT DISTINCT question_id FROM attempts WHERE user_id = ?").all(user.id) as { question_id: string }[]).map((r) => r.question_id));
  const current = papers.find((p) => p.code === paper);
  return (
    <div className="page container">
      <div className="label">Question bank</div>
      <h1 className="h1" style={{ margin: "6px 0 16px" }}>Pick a question. <span className="boxed mint">Write.</span></h1>
      <div className="tabs" role="navigation" aria-label="Filter by paper" style={{ marginBottom: 14 }}>
        <Link className={`btn sm ${!paper ? "ink" : "ghost"}`} href="/practice">All papers</Link>
        {papers.map((p) => (
          <Link key={p.code} className={`btn sm ${paper === p.code ? "ink" : "ghost"}`} href={`/practice?paper=${encodeURIComponent(p.code)}`}>
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
