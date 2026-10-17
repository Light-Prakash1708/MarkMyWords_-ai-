import Link from "next/link";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { currentUser } from "@/lib/http";
import { DISCLAIMER } from "@/lib/copy/disclaimer";
import { isGuest, trialConfig, trialOverview } from "@/lib/services/trial";
import { QuestionMeta } from "@/components/QuestionBits";
import { Bunting, HangingTags, Ribbon, Squiggle, Star, type HangingTag } from "@/components/Landing";
import { TrialButton } from "@/components/TrialButton";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Try it free",
  description: "Answer exam-style questions for UPSC Mains and RBI Grade B and get evidence-linked feedback — no account needed.",
};

const TONES = ["bg-pink", "bg-sky", "bg-mint", "bg-butter", "bg-lilac", "bg-peach"];
const TILTS = ["-1.2deg", "0.8deg", "-0.5deg", "1deg", "-0.9deg", "0.6deg"];
const TAG_COLORS = ["var(--pink)", "var(--butter)", "var(--sky)", "var(--mint)"];

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
  const tags: HangingTag[] = exams.map((e, i) => ({
    t: e.short_name.toUpperCase().replace("GRADE", "GR."),
    s: e.stage === "preview" ? "PREVIEW" : `${e.limit} FREE`,
    c: TAG_COLORS[i % TAG_COLORS.length],
    href: `#exam-${e.code}`,
    drop: i % 2 ? 18 : 0,
  }));

  return (
    <>
      <section className="try-hero">
        <div className="awning" aria-hidden="true" />
        <Bunting />
        <div className="container" style={{ position: "relative", paddingTop: 26, paddingBottom: 6 }}>
          <Star size={46} color="var(--pink)" style={{ left: "3%", top: 40 }} />
          <Star size={30} color="var(--lilac)" style={{ right: "5%", top: 16, animationDelay: "-2s" }} />
          <Star size={34} color="var(--mint)" style={{ right: "12%", bottom: 20, animationDelay: "-4s" }} />
          <div className="reveal">
            <div className="signboard">
              <span className="bolt l" />
              <span className="bolt r" />
              <div className="label" style={{ color: "rgba(23,20,17,.7)" }}>Free trial · no account · no card</div>
              <h1 className="display" style={{ marginTop: 6 }}>
                Write one.
                <br />
                <span className="boxed pink">See</span> the difference.
              </h1>
              <div className="sub">{cfg.answers_per_exam} free answers for each exam</div>
            </div>
          </div>
          <ol className="try-steps" aria-label="How the trial works">
            {["✍️ Write first", "🔍 30-second self-check", "🖍️ Evidence-linked feedback", "🔁 Rewrite & compare"].map((s, i) => (
              <li key={s} className="chip" style={{ ["--i" as string]: i, background: "var(--surface)", color: "var(--ink)", padding: "8px 14px", fontSize: ".9rem" }}>{s}</li>
            ))}
          </ol>
          <div className="sign-rope" aria-hidden="true" style={{ height: 26 }} />
          <HangingTags tags={tags} />
        </div>
      </section>

      <Ribbon tilt items={["No sign-up needed", "Your answers stay private", "Feedback points at your own words", "AI estimates, never official marks", "Fix it yourself, then compare", "UPSC Mains · RBI Grade B"]} />

      <div className="page container stack" style={{ ["--gap" as string]: "46px" }}>
        {guest && (
          <div className="note-box row between reveal" style={{ gap: 12 }}>
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
            <section key={e.code} id={`exam-${e.code}`} className="try-section" aria-labelledby={`h-${e.code}`}>
              <div className="try-head reveal">
                <div>
                  <div className="label">{e.stage === "preview" ? "Preview · new" : "Live"} · {e.name}</div>
                  <h2 id={`h-${e.code}`} className="h1" style={{ margin: "6px 0 0" }}>
                    {e.stage === "preview" ? <span className="boxed butter">{e.short_name}</span> : <span className="boxed mint">{e.short_name}</span>}
                    {e.stage === "preview" && <span className="script" style={{ marginLeft: 12, color: "var(--red-pen)", fontSize: ".7em" }}>preview</span>}
                  </h2>
                  {e.stage === "preview" && (
                    <p className="small muted" style={{ margin: "10px 0 0", maxWidth: 640 }}>
                      Typed answers, as in the real exam. The RBI rubric is new and not yet calibrated against human evaluators, so treat scores as rough estimates — the evidence-linked comments are the useful part.
                    </p>
                  )}
                </div>
                <div className="trial-stamp" aria-live="polite" aria-label={`${left} of ${e.limit} free answers left`}>
                  <b>{left}/{e.limit}</b>
                  <span>free left</span>
                </div>
              </div>
              <div className="try-grid">
                {e.questions.map((q, qi) => {
                  const st = statusLabel(q.attempt_status);
                  const exhausted = !q.attempt_id && left === 0;
                  return (
                    <div key={q.id} className="reveal" style={{ ["--d" as string]: qi }}>
                      <article className={`card pastel try-card ${TONES[(ei * 3 + qi) % TONES.length]}`} style={{ ["--tilt" as string]: TILTS[(ei * 3 + qi) % TILTS.length] }}>
                        <span className="tape" aria-hidden="true" />
                        <span className="qnum" aria-hidden="true">Q{qi + 1}</span>
                        <div className="row between">
                          <span className="label">{q.paper_name}</span>
                          {st && <span className="chip mint">{st}</span>}
                        </div>
                        <p style={{ margin: 0, fontWeight: 650, fontSize: "1.05rem", lineHeight: 1.38 }}>{q.text}</p>
                        <QuestionMeta q={q} />
                        <div className="actions">
                          {q.attempt_id ? (
                            <Link className="btn ink" href={`/attempt/${q.attempt_id}`}>{q.attempt_status === "evaluated" ? "See my feedback →" : "Continue my answer →"}</Link>
                          ) : exhausted ? (
                            <Link className="btn ghost" href="/signup">Sign up to answer this →</Link>
                          ) : q.input_modes.includes("handwritten") ? (
                            <>
                              <TrialButton questionId={q.slug} label="Type my answer" mode="typed" className="btn ink shine" />
                              <TrialButton questionId={q.slug} label="📷 On paper" mode="handwritten" className="btn ghost" />
                            </>
                          ) : (
                            <TrialButton questionId={q.slug} label="Write my answer" mode="typed" className="btn ink shine" />
                          )}
                        </div>
                      </article>
                    </div>
                  );
                })}
              </div>
              {ei < exams.length - 1 && <Squiggle style={{ position: "static", display: "block", margin: "44px auto 0", width: 180, maxWidth: "60%" }} />}
            </section>
          );
        })}

        <section className="card bg-paper2 try-honest reveal" style={{ display: "grid", gap: 10 }}>
          <Star size={28} color="var(--butter)" style={{ right: 18, top: -14 }} />
          <h2 className="h3" style={{ margin: 0 }}>What the trial includes — honestly</h2>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            <li>The same evaluator, hint ladder and rewrite comparison as a full account. Every score is labelled “{DISCLAIMER.short}”.</li>
            <li>No model answer before you write. Guidance unlocks after your own attempt.</li>
            <li>Your trial answers are private. MarkMyWords does not use them for benchmarks or model improvement.</li>
            <li>Unsaved guest work is deleted after {cfg.purge_guests_after_days} days. Creating a free account keeps everything.</li>
          </ul>
          <div className="row" style={{ gap: 10 }}>
            <Link className="btn shine" href="/signup">{guest ? "Save my work — create account" : "Create free account"}</Link>
            <Link className="btn ghost" href="/how-we-evaluate">How we mark →</Link>
          </div>
        </section>
      </div>
    </>
  );
}
