import Link from "next/link";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { currentUser } from "@/lib/http";
import { DISCLAIMER } from "@/lib/copy/disclaimer";
import { isGuest, trialConfig, trialOverview } from "@/lib/services/trial";
import { QuestionMeta } from "@/components/QuestionBits";
import { Star } from "@/components/Landing";
import { TrialButton } from "@/components/TrialButton";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Try it free",
  description: "Answer real exam-style questions for UPSC Mains and RBI Grade B and get evidence-linked feedback — no account needed.",
};

const TONES = ["bg-pink", "bg-sky", "bg-mint", "bg-butter", "bg-lilac", "bg-peach"];

function statusLabel(s: string | null) {
  if (!s) return null;
  if (s === "evaluated") return "Feedback ready";
  if (s === "draft") return "Draft saved";
  if (s === "evaluating") return "Marking…";
  return "In progress";
}

export default async function TryPage() {
  const user = await currentUser();
  const guest = isGuest(user);
  const db = await getDb();
  const exams = await trialOverview(db, user);
  const cfg = trialConfig();
  const env = getEnv();
  const ai = env.provider === "anthropic" || env.provider === "gemini";

  return (
    <>
      <section className="grid-paper" style={{ ["--bgc" as string]: "var(--sky)", position: "relative", overflow: "hidden", borderBottom: "var(--bw) solid var(--line)" }}>
        <Star size={48} color="var(--pink)" style={{ left: "6%", top: 34 }} />
        <Star size={30} color="var(--butter)" style={{ right: "8%", top: 60, animationDelay: "-3s" }} />
        <div className="container" style={{ padding: "46px 16px 40px", textAlign: "center" }}>
          <span className="ink-label">Free trial · no account</span>
          <h1 className="display" style={{ margin: "16px auto 10px", maxWidth: 900, color: "var(--on-pastel)" }}>
            Write one. <span className="boxed butter">See</span> the difference.
          </h1>
          <p style={{ maxWidth: 640, margin: "0 auto", fontSize: "1.08rem", color: "var(--on-pastel)" }}>
            Pick a question below, write your own answer, and get feedback that points at your exact sentences — then fix it yourself.
            You can try {cfg.answers_per_exam} questions for each exam. No sign-up needed.
          </p>
          <ol className="row" style={{ listStyle: "none", padding: 0, margin: "22px auto 0", justifyContent: "center", gap: 8 }}>
            {["1 · Write first", "2 · 30-second self-check", "3 · Evidence-linked feedback", "4 · Rewrite & compare"].map((s) => (
              <li key={s} className="chip" style={{ background: "rgba(255,255,255,.7)", color: "var(--on-pastel)", borderColor: "var(--on-pastel)" }}>{s}</li>
            ))}
          </ol>
        </div>
      </section>

      <div className="page container stack" style={{ ["--gap" as string]: "38px" }}>
        {guest && (
          <div className="note-box row between" style={{ gap: 12 }}>
            <span>You are in a private guest trial. Your answers are kept for {cfg.purge_guests_after_days} days — create a free account to keep them for good.</span>
            <Link className="btn sm" href="/signup">Save my work</Link>
          </div>
        )}
        {!ai && (
          <p className="note-box small" style={{ margin: 0 }}>
            Feedback on this deployment comes from the rule-based demo evaluator, because no AI model is configured.
          </p>
        )}

        {exams.map((e, ei) => {
          const left = Math.max(0, e.limit - e.used);
          return (
            <section key={e.code} aria-labelledby={`exam-${e.code}`}>
              <div className="row between" style={{ alignItems: "flex-end", marginBottom: 14, gap: 12 }}>
                <div>
                  <div className="label">{e.stage === "preview" ? "Preview · new" : "Live"}</div>
                  <h2 id={`exam-${e.code}`} className="h1" style={{ margin: "4px 0 0" }}>
                    {e.short_name} {e.stage === "preview" && <span className="chip butter" style={{ verticalAlign: "middle", fontSize: ".8rem" }}>Preview</span>}
                  </h2>
                  <p className="small muted" style={{ margin: "6px 0 0", maxWidth: 640 }}>{e.name}</p>
                </div>
                <span className="sticker" style={{ background: "var(--surface)", color: "var(--ink)" }} aria-live="polite">
                  {left} of {e.limit} free {left === 1 ? "answer" : "answers"} left
                </span>
              </div>
              {e.stage === "preview" && (
                <p className="small muted" style={{ marginTop: 0 }}>
                  Typed answers, as in the real exam. The RBI rubric is new and not yet calibrated against human evaluators, so treat scores as rough estimates; the evidence-linked comments are the useful part.
                </p>
              )}
              <div className="grid grid-3">
                {e.questions.map((q, qi) => {
                  const st = statusLabel(q.attempt_status);
                  const exhausted = !q.attempt_id && left === 0;
                  return (
                    <article key={q.id} className={`card pastel ${TONES[(ei * 3 + qi) % TONES.length]} reveal`} style={{ display: "flex", flexDirection: "column", gap: 12, ["--d" as string]: qi }}>
                      <div className="row between">
                        <span className="label">{q.paper_name}</span>
                        {st && <span className="chip mint">{st}</span>}
                      </div>
                      <p style={{ margin: 0, fontWeight: 650, fontSize: "1.05rem", lineHeight: 1.35 }}>{q.text}</p>
                      <QuestionMeta q={q} />
                      <div style={{ marginTop: "auto" }}>
                        {q.attempt_id ? (
                          <Link className="btn ink" href={`/attempt/${q.attempt_id}`}>{q.attempt_status === "evaluated" ? "See my feedback →" : "Continue my answer →"}</Link>
                        ) : exhausted ? (
                          <Link className="btn ghost" href="/signup">Sign up to answer this →</Link>
                        ) : q.input_modes.includes("handwritten") ? (
                          <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
                            <TrialButton questionId={q.slug} label="Type my answer" mode="typed" className="btn ink" />
                            <TrialButton questionId={q.slug} label="On paper" mode="handwritten" className="btn ghost" />
                          </div>
                        ) : (
                          <TrialButton questionId={q.slug} label="Write my answer" mode="typed" className="btn ink" />
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}

        <section className="card bg-paper2" style={{ display: "grid", gap: 10 }}>
          <h2 className="h3" style={{ margin: 0 }}>What the trial includes — honestly</h2>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            <li>The same evaluator, hint ladder and rewrite comparison as a full account. Every score is labelled “{DISCLAIMER.short}”.</li>
            <li>No model answer before you write. Guidance unlocks after your own attempt.</li>
            <li>Your trial answers are private. MarkMyWords does not use them for benchmarks or model improvement.</li>
            <li>Unsaved guest work is deleted after {cfg.purge_guests_after_days} days. Creating a free account keeps everything.</li>
          </ul>
          <div className="row" style={{ gap: 10 }}>
            <Link className="btn" href="/signup">{guest ? "Save my work — create account" : "Create free account"}</Link>
            <Link className="btn ghost" href="/how-we-evaluate">How we mark →</Link>
          </div>
        </section>
      </div>
    </>
  );
}
