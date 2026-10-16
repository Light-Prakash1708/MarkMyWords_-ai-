import Link from "next/link";
import type { QuestionView } from "@/lib/services/questions";

const PASTELS = ["bg-sky", "bg-pink", "bg-mint", "bg-butter", "bg-lilac", "bg-peach"];

export function pastelFor(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PASTELS[h % PASTELS.length];
}

export function ReviewBadge({ status }: { status: QuestionView["review_status"] }) {
  if (status === "approved") return <span className="chip mint" title="Approved by a human reviewer">✓ Reviewed</span>;
  return (
    <span className="chip dashed" title="Original practice question awaiting expert review. Shown in demo mode.">
      Pending expert review
    </span>
  );
}

export function QuestionMeta({ q }: { q: QuestionView }) {
  return (
    <div className="row" style={{ gap: 6 }}>
      <span className="chip ink">{q.paper_code.replace(/^GS/, "GS-")}</span>
      <span className="chip">{q.marks} marks</span>
      {q.word_limit && <span className="chip">~{q.word_limit} words</span>}
      <span className="chip">{q.time_budget_min} min</span>
      {q.directive_codes.map((d) => (
        <span key={d} className="chip butter">{d.replace(/_/g, " ").toLowerCase()}</span>
      ))}
    </div>
  );
}

export function QuestionCard({ q, reason, cta = "Write an answer", tone }: { q: QuestionView; reason?: string; cta?: string; tone?: string }) {
  return (
    <Link href={`/q/${q.slug}`} className={`card pastel lift ${tone ?? pastelFor(q.slug)}`} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="row between">
        <span className="label">{q.paper_name}</span>
        <ReviewBadge status={q.review_status} />
      </div>
      <p style={{ margin: 0, fontWeight: 650, fontSize: "1.05rem", lineHeight: 1.35 }}>{q.text}</p>
      {reason && <p className="small" style={{ margin: 0, fontStyle: "italic" }}>{reason}</p>}
      <div className="row between" style={{ marginTop: "auto" }}>
        <QuestionMeta q={q} />
        <span style={{ fontWeight: 750 }}>{cta} →</span>
      </div>
    </Link>
  );
}
