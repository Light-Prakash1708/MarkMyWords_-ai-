import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/http";
import { isGuest } from "@/lib/services/trial";
import { DISCLAIMER } from "@/lib/copy/disclaimer";
import { Bunting, HangingTags, RedPenDemo, Ribbon, Squiggle, Star, Truths } from "@/components/Landing";

export default async function Home() {
  const user = await currentUser();
  if (user) redirect(isGuest(user) ? "/try" : "/today");

  return (
    <>
      <section className="hero-wrap" style={{ background: "var(--paper)" }}>
        <div className="awning" aria-hidden="true" />
        <Bunting />
        <div className="container" style={{ position: "relative", paddingTop: 30, paddingBottom: 10 }}>
          <Star size={46} color="var(--pink)" style={{ left: "4%", top: 40 }} />
          <Star size={30} color="var(--lilac)" style={{ right: "6%", top: 10, animationDelay: "-2s" }} />
          <Star size={36} color="var(--mint)" style={{ right: "12%", bottom: -10, animationDelay: "-4s" }} />
          <div style={{ maxWidth: 980, margin: "0 auto" }} className="reveal">
            <div className="signboard">
              <span className="bolt l" />
              <span className="bolt r" />
              <h1 className="display">
                Your answers,
                <br />
                <span className="boxed pink" style={{ marginTop: 8 }}>marked</span> honestly
              </h1>
              <div className="sub">Not just a score — the why, the fix, and proof you&apos;ve improved</div>
            </div>
          </div>
          <div className="row reveal" style={{ justifyContent: "center", marginTop: 28, ["--d" as string]: 1 }}>
            <Link href="/try" className="btn lg">Try 3 questions free — no sign-up</Link>
            <Link href="/signup" className="btn lg ghost">Create free account</Link>
          </div>
          <p className="muted small" style={{ textAlign: "center", marginTop: 14 }}>
            UPSC CSE Mains GS-II &amp; GS-III · RBI Grade B Phase II (preview). {DISCLAIMER.short}.
          </p>
          <div className="sign-rope" aria-hidden="true" style={{ height: 30 }} />
          <HangingTags />
        </div>
      </section>

      <Ribbon
        tilt
        items={["Attempt first", "Evidence or it didn't happen", "AI estimates, never official marks", "Repair → retest → transfer", "Cited sources only", "No silent guessing on handwriting", "Your answers stay private"]}
      />

      <section className="page container">
        <div className="row between reveal" style={{ alignItems: "flex-end", marginBottom: 22 }}>
          <div>
            <div className="label">Live demo · red pen</div>
            <h2 className="h1" style={{ marginTop: 6 }}>
              Feedback that <span className="script" style={{ color: "var(--red-pen)" }}>points</span> at your words
            </h2>
          </div>
          <p className="muted" style={{ maxWidth: 420 }}>
            Every comment is anchored to the exact sentence it is about. Factual corrections come with a cited source — or they are marked uncertain.
          </p>
        </div>
        <RedPenDemo />
      </section>

      <section className="grid-paper" style={{ ["--bgc" as string]: "var(--lilac)", borderTop: "var(--bw) solid var(--line)", borderBottom: "var(--bw) solid var(--line)", position: "relative", overflow: "hidden" }}>
        <div className="container page">
          <div className="reveal" style={{ textAlign: "center", marginBottom: 30 }}>
            <span className="ink-label">The loop is the product</span>
            <h2 className="h1" style={{ marginTop: 14 }}>
              Six steps. <span className="boxed butter">One habit.</span>
            </h2>
          </div>
          <Squiggle style={{ right: "4%", top: 40, opacity: 0.8 }} />
          <div className="loop">
            {[
              { n: "01", t: "Discover", d: "A daily question tied to the syllabus — with why the topic matters, never a ‘prediction’.", c: "bg-butter" },
              { n: "02", t: "Attempt", d: "Write under exam timing: typed, or photograph your handwritten sheet.", c: "bg-sky" },
              { n: "03", t: "Diagnose", d: "Criterion-wise estimate with evidence, sources and honest confidence.", c: "bg-pink" },
              { n: "04", t: "Repair", d: "Climb the hint ladder only as far as you need — then rewrite it yourself.", c: "bg-mint" },
              { n: "05", t: "Retest", d: "A fresh related question two days later. No hints. Did the fix hold?", c: "bg-peach" },
              { n: "06", t: "Improve", d: "Your skill profile separates ‘fixed when prompted’ from ‘holds on new questions’.", c: "bg-coral" },
            ].map((s, i) => (
              <div key={s.n} className={`card pastel lift reveal ${s.c}`} style={{ ["--d" as string]: i }}>
                <span className="num">{s.n}</span>
                <h3>{s.t}</h3>
                <p style={{ margin: 0 }}>{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="page container">
        <div className="reveal" style={{ marginBottom: 24 }}>
          <h2 className="h1">
            <span className="boxed">Four things</span> we hold to be true
          </h2>
          <div className="ink-label" style={{ marginTop: 14 }}>The principles behind every feature</div>
        </div>
        <div className="reveal" style={{ ["--d" as string]: 1 }}>
          <Truths />
        </div>
      </section>

      <section className="container" style={{ paddingBottom: 70 }}>
        <div className="reveal" style={{ marginBottom: 22 }}>
          <div className="label">Why not just ask a chatbot?</div>
          <h2 className="h2" style={{ marginTop: 6 }}>A good prompt isn&apos;t a practice system.</h2>
        </div>
        <div className="versus reveal">
          <div style={{ background: "var(--surface)" }}>
            <div className="label">A general chatbot</div>
            <ul>
              {["Evaluates one answer if you prompt it well", "Hands you a model answer immediately", "Forgets your weaknesses between chats", "Suggests facts without sources", "Guesses your handwriting silently"].map((x) => (
                <li key={x}><span aria-hidden="true">—</span>{x}</li>
              ))}
            </ul>
          </div>
          <div className="bg-mint" style={{ color: "var(--on-pastel)", borderLeft: "var(--bw) solid var(--line)" }}>
            <div className="label" style={{ color: "rgba(23,20,17,.7)" }}>MarkMyWords</div>
            <ul>
              {["Exam-specific, versioned rubric — the same every time", "Attempt first; guidance unlocks step by step", "An error ledger that follows you across answers", "Factual corrections must cite a source", "Uncertain handwriting goes back to you to confirm"].map((x) => (
                <li key={x}><span aria-hidden="true">✓</span>{x}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="grid-paper" style={{ ["--bgc" as string]: "var(--butter)", borderTop: "var(--bw) solid var(--line)" }}>
        <div className="container page" style={{ textAlign: "center" }}>
          <h2 className="display reveal" style={{ fontSize: "clamp(2.2rem, 7vw, 4.6rem)" }}>
            Write today&apos;s answer.
            <br />
            <span className="script" style={{ textTransform: "none", fontSize: "1.1em" }}>see what it&apos;s missing.</span>
          </h2>
          <div className="row reveal" style={{ justifyContent: "center", marginTop: 26 }}>
            <Link href="/signup" className="btn lg ink">Create a free account</Link>
            <Link href="/login" className="btn lg">I have an account</Link>
          </div>
        </div>
      </section>
      <footer className="footer">
        <div className="container row between">
          <div className="row"><strong>MarkMyWords</strong><span className="muted small">Practice and improvement for descriptive exam answers.</span></div>
          <p className="muted small" style={{ maxWidth: 560, margin: 0 }}>{DISCLAIMER.long}</p>
        </div>
      </footer>
    </>
  );
}
