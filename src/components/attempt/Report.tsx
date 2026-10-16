"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Disclaimer } from "@/lib/copy/disclaimer";
import type { EvalComment, EvaluationResult } from "@/lib/schemas/evaluation";
import { api, ApiError } from "../api";

const KIND_LABEL: Record<EvalComment["kind"], string> = {
  strength: "Strength",
  weakness: "Weakness",
  factual_error: "Factual issue",
  missing_dimension: "Missing",
  structure: "Structure",
  presentation: "Presentation",
};

function CountUp({ to, decimals = 1 }: { to: number; decimals?: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return setV(to);
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 900);
      setV(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>{v.toFixed(decimals)}</>;
}

/** Score display REQUIRES a disclaimer (principle P3) — the type makes it impossible to omit. */
export function ScoreStamp({ total, disclaimer }: { total: EvaluationResult["total"]; disclaimer: Disclaimer }) {
  const half = (x: number) => (Math.round(x * 2) / 2).toString();
  return (
    <div className="row" style={{ gap: 22, alignItems: "center" }}>
      <div className="stamp" aria-label={`AI estimate ${total.range.low} to ${total.range.high} out of ${total.max}`}>
        <div>
          <div className="tiny-l">AI estimate</div>
          <div className="big"><CountUp to={total.point_estimate} /></div>
          <div className="of">/ {total.max}</div>
          <div className="tiny-l">range {half(total.range.low)}–{half(total.range.high)}</div>
        </div>
      </div>
      <div className="stack" style={{ ["--gap" as string]: "8px", flex: 1, minWidth: 220 }}>
        <div className="row">
          <span className={`chip ${total.confidence === "high" ? "mint" : total.confidence === "medium" ? "butter" : "coral"}`}>Confidence: {total.confidence}</span>
          {total.confidence_reasons.map((r) => <span key={r} className="chip dashed" title={r}>{r.replace(/_/g, " ")}</span>)}
        </div>
        <div className="disclaimer-bar" role="note">
          <strong>Not official</strong>
          <span>{disclaimer.long} <Link href="/how-we-evaluate">How we mark</Link></span>
        </div>
      </div>
    </div>
  );
}

interface Seg { start: number; end: number; ids: string[]; unc: boolean }

function segments(text: string, comments: EvalComment[], unc: { start: number; end: number }[]): Seg[] {
  const cuts = new Set<number>([0, text.length]);
  for (const c of comments) for (const s of c.evidence.answer_spans) { cuts.add(s.start); cuts.add(s.end); }
  for (const u of unc) { cuts.add(u.start); cuts.add(u.end); }
  const pts = [...cuts].filter((x) => x >= 0 && x <= text.length).sort((a, b) => a - b);
  const out: Seg[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (a === b) continue;
    const ids = comments.filter((c) => c.evidence.answer_spans.some((s) => s.start <= a && s.end >= b)).map((c) => c.id);
    out.push({ start: a, end: b, ids, unc: unc.some((u) => u.start <= a && u.end >= b) });
  }
  return out;
}

export function AnnotatedAnswer({ text, comments, uncertain, active, setActive }: { text: string; comments: EvalComment[]; uncertain: { start: number; end: number }[]; active: string | null; setActive: (id: string | null) => void }) {
  const segs = useMemo(() => segments(text, comments, uncertain), [text, comments, uncertain]);
  const byId = useMemo(() => new Map(comments.map((c) => [c.id, c])), [comments]);
  const endsAt = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const c of comments) {
      const s = c.evidence.answer_spans[0];
      if (s) m.set(s.end, [...(m.get(s.end) ?? []), c.id]);
    }
    return m;
  }, [comments]);
  return (
    <div className="sheet" style={{ ["--lh" as string]: "2.05rem" }}>
      <div className="answer-text">
        {segs.map((s) => {
          const t = text.slice(s.start, s.end);
          if (!s.ids.length && !s.unc) return <span key={s.start}>{t}</span>;
          const cs = s.ids.map((id) => byId.get(id)!).filter(Boolean);
          const cls = cs.some((c) => c.kind === "factual_error") ? "fact" : cs.some((c) => c.kind !== "strength" && !c.uncertain) ? "weak" : cs.some((c) => c.kind === "strength") && !cs.some((c) => c.kind !== "strength") ? "strong" : "unc";
          const tags = endsAt.get(s.end)?.filter((id) => s.ids.includes(id)) ?? [];
          if (!cs.length) return <span key={s.start} className="ocr-unc" title="Uncertain transcription">{t}</span>;
          return (
            <button
              key={s.start}
              type="button"
              className={`mark ${cls}${cs.some((c) => c.id === active) ? " active" : ""}`}
              onClick={() => {
                setActive(cs[0].id);
                document.getElementById(`note-${cs[0].id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
              }}
              aria-label={`Annotated text. ${cs.map((c) => `${KIND_LABEL[c.kind]}: ${c.message}`).join(" ")}`}
            >
              {t}
              {tags.map((id) => <sup key={id}>{id.slice(1)}</sup>)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DisputeForm({ evaluationId, commentId, onDone }: { evaluationId: string; commentId: string | null; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="stack" style={{ ["--gap" as string]: "8px", marginTop: 8 }}>
      <label className="sr-only" htmlFor={`d-${commentId}`}>Why do you disagree?</label>
      <textarea id={`d-${commentId}`} className="textarea" style={{ minHeight: 70 }} placeholder="What did we get wrong? Point to your sentence or a source." value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
      <div className="row">
        <button
          className="btn sm"
          disabled={busy || reason.trim().length < 5}
          onClick={async () => {
            setBusy(true);
            try {
              await api(`/api/evaluations/${evaluationId}/disputes`, { body: { comment_id: commentId, reason } });
              setMsg("Sent to a human reviewer. You'll see the outcome here.");
              setTimeout(onDone, 1800);
            } catch (e) {
              setMsg(e instanceof ApiError ? e.message : "Could not send.");
              setBusy(false);
            }
          }}
        >
          Send to reviewer
        </button>
        {msg && <span className="small">{msg}</span>}
      </div>
    </div>
  );
}

function CommentCard({ c, active, setActive, evaluationId, disputed }: { c: EvalComment; active: boolean; setActive: (id: string | null) => void; evaluationId: string; disputed?: { status: string; resolution: string | null } }) {
  const [open, setOpen] = useState(false);
  return (
    <article id={`note-${c.id}`} className={`margin-note${c.kind === "strength" ? " strength" : ""}${c.uncertain ? " uncertain" : ""}${active ? " active" : ""}`} onMouseEnter={() => setActive(c.id)}>
      <div className="row between" style={{ gap: 6 }}>
        <div className="row" style={{ gap: 6 }}>
          <span className="mono tiny" style={{ fontWeight: 700 }}>#{c.id.slice(1)}</span>
          <span className={`chip ${c.kind === "strength" ? "mint" : c.kind === "factual_error" ? "red" : "coral"}`}>{KIND_LABEL[c.kind]}</span>
          {c.kind !== "strength" && <span className="chip">{c.severity}</span>}
          <span className="chip dashed">{c.criterion_code.toLowerCase()}</span>
        </div>
        {c.uncertain && (
          <details className="tiny">
            <summary className="chip butter">Uncertain — why?</summary>
            <div style={{ marginTop: 6 }}>{c.uncertainty_reason?.replace(/_/g, " ") ?? "The evaluator was not confident."} Treat this comment as a prompt to check, not a verdict.</div>
          </details>
        )}
      </div>
      <p style={{ margin: "8px 0" }}>{c.message}</p>
      {c.evidence.answer_spans[0] && (
        <button type="button" className="linkish tiny" onClick={() => { setActive(c.id); document.querySelector(".mark.active")?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>
          Show in my answer
        </button>
      )}
      {c.kind !== "strength" && c.suggestion && <p className="small" style={{ margin: "6px 0" }}><strong>Try:</strong> {c.suggestion}</p>}
      {c.evidence.citations.map((ci) => (
        <div key={ci.source_chunk_id + ci.quote} className="note-box tiny" style={{ marginTop: 6 }}>
          <div className="row between"><strong>{ci.source_title}</strong><span className="chip">{ci.text_kind === "verbatim" ? "verbatim" : "our summary"} · {ci.verification_status}</span></div>
          <div className="quote">“{ci.quote}”</div>
          <a href={ci.source_url} target="_blank" rel="noreferrer noopener">Official reference ↗</a>
          {ci.may_be_outdated && <span className="chip butter" style={{ marginLeft: 6 }}>may be outdated</span>}
        </div>
      ))}
      {disputed ? (
        <p className="tiny" style={{ marginTop: 8 }}><span className="chip">{disputed.status === "open" ? "Under human review" : `Reviewed: ${disputed.status.replace("_", " ")}`}</span> {disputed.resolution}</p>
      ) : (
        <div className="row" style={{ marginTop: 6 }}>
          <button type="button" className="linkish tiny" onClick={() => setOpen((x) => !x)} aria-expanded={open}>I disagree</button>
        </div>
      )}
      {open && <DisputeForm evaluationId={evaluationId} commentId={c.id} onDone={() => location.reload()} />}
    </article>
  );
}

export function Report(props: {
  evaluationId: string;
  attemptId: string;
  attemptKind: string;
  questionId: string;
  questionSlug: string;
  result: EvaluationResult;
  text: string;
  uncertain: { start: number; end: number }[];
  disclaimer: Disclaimer;
  disputes: { comment_id: string | null; status: string; resolution: string | null }[];
  retestOffer: { id: string; question_slug: string; skill_name: string; due_at: string } | null;
  heuristicNotice: string | null;
}) {
  const r = props.result;
  const router = useRouter();
  const [active, setActive] = useState<string | null>(r.top_priorities[0]?.comment_id ?? null);
  const [filter, setFilter] = useState<"all" | "issues" | "strengths">("all");
  const [busy, setBusy] = useState(false);
  const [rewriteErr, setRewriteErr] = useState<string | null>(null);
  const comments = r.comments.filter((c) => (filter === "all" ? true : filter === "issues" ? c.kind !== "strength" : c.kind === "strength"));
  const disputeFor = (id: string) => props.disputes.find((d) => d.comment_id === id);

  async function startRewrite() {
    setBusy(true);
    try {
      const res = await api<{ attempt: { id: string } }>("/api/attempts", { body: { question_id: props.questionId, mode: "typed", attempt_kind: "rewrite", parent_attempt_id: props.attemptId, timer_mode: "untimed" } });
      router.push(`/attempt/${res.attempt.id}`);
    } catch (e) {
      setRewriteErr(e instanceof ApiError ? e.message : "Could not start a rewrite.");
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ ["--gap" as string]: "26px" }}>
      <section className="card">
        <ScoreStamp total={r.total} disclaimer={props.disclaimer} />
        {props.heuristicNotice && <div className="note-box small" style={{ marginTop: 14 }}>{props.heuristicNotice}</div>}
        <dl className="spec" style={{ marginTop: 18 }}>
          <div><dt>Rubric</dt><dd>{r.rubric.code} v{r.rubric.version}</dd></div>
          <div><dt>Rubric status</dt><dd>{r.rubric.status}</dd></div>
          <div><dt>Words</dt><dd>{r.word_limit.count}{r.word_limit.limit ? ` / ~${r.word_limit.limit}` : ""} · {r.word_limit.status.replace("_", " ")}</dd></div>
          <div><dt>Evaluator</dt><dd>{r.evaluator.is_ai ? "AI" : "Rules (demo)"}</dd></div>
          <div><dt>Samples</dt><dd>{r.diagnostics.samples_run}</dd></div>
          <div><dt>Auto-repairs</dt><dd>{r.diagnostics.validator_repairs}</dd></div>
        </dl>
      </section>

      {r.top_priorities.length > 0 && (
        <section>
          <h2 className="h2" style={{ marginBottom: 14 }}>Fix these first</h2>
          <div className="grid grid-3">
            {r.top_priorities.map((p, i) => {
              const c = r.comments.find((x) => x.id === p.comment_id)!;
              return (
                <button key={p.comment_id} type="button" className={`card pastel lift ${["bg-pink", "bg-butter", "bg-sky"][i]}`} style={{ textAlign: "left", cursor: "pointer" }} onClick={() => { setActive(c.id); document.getElementById(`note-${c.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>
                  <div className="row between"><span className="h2" style={{ fontSize: "2rem" }}>{i + 1}</span><span className="chip">{c.skill_tag.split(".")[1]?.replace(/_/g, " ")}</span></div>
                  <p style={{ margin: "8px 0", fontWeight: 650 }}>{c.message}</p>
                  <p className="tiny" style={{ margin: 0 }}>{p.why_first}</p>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <div className="row between" style={{ marginBottom: 12 }}>
          <h2 className="h2">Your answer, marked</h2>
          <div className="tabs" role="group" aria-label="Filter comments">
            {(["all", "issues", "strengths"] as const).map((f) => (
              <button key={f} className={`btn sm ${filter === f ? "ink" : "ghost"}`} onClick={() => setFilter(f)} aria-pressed={filter === f}>{f}</button>
            ))}
          </div>
        </div>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))", alignItems: "start" }}>
          <div style={{ position: "sticky", top: 76 }}>
            <AnnotatedAnswer text={props.text} comments={comments} uncertain={props.uncertain} active={active} setActive={setActive} />
            <p className="tiny muted" style={{ marginTop: 8 }}>
              <span style={{ textDecoration: "underline wavy var(--red-pen)" }}>issue</span> · <span style={{ textDecoration: "underline double var(--red-pen)" }}>factual</span> · <span style={{ textDecoration: "underline solid var(--green-pen)" }}>strength</span> · <span style={{ textDecoration: "underline dotted var(--uncertain)", textDecorationThickness: 3 }}>uncertain</span>
            </p>
          </div>
          <div className="stack" style={{ ["--gap" as string]: "12px" }}>
            {comments.map((c) => (
              <CommentCard key={c.id} c={c} active={active === c.id} setActive={setActive} evaluationId={props.evaluationId} disputed={disputeFor(c.id)} />
            ))}
            {!comments.length && <p className="muted">No comments in this view.</p>}
          </div>
        </div>
      </section>

      <section className="grid grid-2" style={{ alignItems: "start" }}>
        <div className="card">
          <h2 className="h3">Criterion by criterion</h2>
          <div className="stack" style={{ marginTop: 12 }}>
            {r.criteria.map((c) => (
              <details key={c.code} className="note-box" style={{ background: "var(--surface)" }}>
                <summary className="row between">
                  <span style={{ fontWeight: 700 }}>{c.name}</span>
                  <span className="row" style={{ gap: 8 }}>
                    <span className="bands" aria-label={`Band ${c.band} of ${c.max_band}`}>
                      {Array.from({ length: c.max_band }).map((_, k) => (
                        <i key={k} className={k < c.band ? "on" : k < c.band_range.high ? "range" : ""} style={{ ["--k" as string]: k, ["--c" as string]: c.band / c.max_band >= 0.75 ? "var(--mint)" : c.band / c.max_band >= 0.5 ? "var(--butter)" : "var(--coral)" }} />
                      ))}
                    </span>
                    <span className="mono small">{c.marks_awarded.toFixed(1)}/{c.marks_max.toFixed(1)}</span>
                  </span>
                </summary>
                <p className="small" style={{ margin: "10px 0 4px" }}><strong>{c.descriptor_matched}:</strong> {c.descriptor_text}</p>
                <p className="small muted" style={{ margin: 0 }}>{c.rationale}</p>
                {c.band_range.low !== c.band_range.high && <p className="tiny" style={{ margin: "6px 0 0" }}>Samples disagreed: band {c.band_range.low}–{c.band_range.high}.</p>}
              </details>
            ))}
          </div>
        </div>
        <div className="stack">
          <div className="card">
            <h2 className="h3">Did you answer what was asked?</h2>
            <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "grid", gap: 8 }}>
              {r.question_demand_analysis.parts.map((p) => (
                <li key={p.part_id} className="row between" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
                  <span>{p.demand}</span>
                  <span className={`chip ${p.addressed === "fully" ? "mint" : p.addressed === "partially" ? "butter" : "coral"}`}>{p.addressed}</span>
                </li>
              ))}
              {r.question_demand_analysis.directive_compliance.map((d) => (
                <li key={d.directive} className="small">
                  <span className={`chip ${d.met ? "mint" : "coral"}`}>{d.directive.replace(/_/g, " ").toLowerCase()}: {d.met ? "done" : "not yet"}</span> {d.explanation}
                </li>
              ))}
            </ul>
          </div>
          {r.factual_checks.length > 0 && (
            <div className="card">
              <h2 className="h3">Fact checks</h2>
              <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "grid", gap: 10 }}>
                {r.factual_checks.map((f, i) => (
                  <li key={i}>
                    <span className={`chip ${f.verdict === "supported" ? "mint" : f.verdict === "unverifiable" ? "butter" : "red"}`}>{f.verdict}</span>{" "}
                    <span className="quote" style={{ display: "inline" }}>“{f.claim_span.quote}”</span>
                    <div className="small">{f.note}</div>
                    {f.citations.map((c) => <a key={c.source_chunk_id} className="tiny" href={c.source_url} target="_blank" rel="noreferrer noopener">{c.source_title} ({c.verification_status}) ↗</a>)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {r.self_assessment_gap && r.self_assessment_gap.length > 0 && (
            <div className="card pastel bg-lilac">
              <h2 className="h3">Your self-check vs the estimate</h2>
              <p className="small">Average gap: <strong>{(r.self_assessment_gap.reduce((s, g) => s + Math.abs(g.self_band - g.ai_band), 0) / r.self_assessment_gap.length).toFixed(1)} bands</strong>. Closer is better — it means you can judge your own writing.</p>
              <div className="stack" style={{ ["--gap" as string]: "6px" }}>
                {r.self_assessment_gap.map((g) => (
                  <div key={g.criterion_code} className="row between small" style={{ flexWrap: "nowrap" }}>
                    <span>{r.criteria.find((c) => c.code === g.criterion_code)?.name}</span>
                    <span className="mono">you {g.self_band} · est. {g.ai_band} {g.self_band > g.ai_band ? "↑ generous" : g.self_band < g.ai_band ? "↓ harsh" : "✓"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {r.rewrite_delta && r.rewrite_delta.length > 0 && (
        <section className="card">
          <h2 className="h3">What changed since your first attempt</h2>
          <p className="small muted">Fixing an answer after feedback is <strong>repair</strong>. The real test comes later: a fresh question with no hints.</p>
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
            {r.rewrite_delta.map((d) => (
              <li key={d.prior_comment_id} className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
                <span className={`chip ${d.status === "resolved" ? "mint" : d.status === "partially" ? "butter" : "coral"}`}>{d.status}</span>
                <span className="small">{d.prior_message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card pastel bg-mint row between">
        <div style={{ maxWidth: 640 }}>
          <div className="label">Your next action</div>
          <p style={{ fontWeight: 700, fontSize: "1.1rem", margin: "6px 0" }}>{r.next_action.instruction}</p>
          {props.retestOffer && <p className="small" style={{ margin: 0 }}>A transfer check on “{props.retestOffer.skill_name}” is scheduled for {new Date(props.retestOffer.due_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}.</p>}
        </div>
        <div className="row">
          {props.attemptKind !== "transfer_retest" && <button className="btn ink" onClick={startRewrite} disabled={busy}>Rewrite it myself</button>}
          <Link className="btn" href="/today">Next question</Link>
        </div>
        {rewriteErr && <div className="error-box" role="alert" style={{ width: "100%" }}>{rewriteErr}</div>}
      </section>
    </div>
  );
}
