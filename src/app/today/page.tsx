import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { currentUser } from "@/lib/http";
import { HEURISTIC_NOTICE } from "@/lib/copy/disclaimer";
import { listAttempts } from "@/lib/services/attempts";
import { getQotd, syllabusTitles } from "@/lib/services/questions";
import { dueRetests, getProgress, recommendNext } from "@/lib/services/skills";
import { practiceStreak } from "@/lib/services/streak";
import { QuestionCard, QuestionMeta, ReviewBadge } from "@/components/QuestionBits";
import { Star } from "@/components/Landing";

export const metadata = { title: "Today" };
export const dynamic = "force-dynamic";

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default async function Today({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const sp = await searchParams;
  const db = getDb();
  const env = getEnv();
  const qotd = getQotd(db, user.target_exam_code);
  const recs = recommendNext(db, user.id, 3).filter((r) => r.question.id !== qotd?.id);
  const retests = dueRetests(db, user.id);
  const progress = getProgress(db, user.id);
  const recent = listAttempts(db, user.id, 5);
  const streak = practiceStreak(db, user.id);
  const syl = qotd ? syllabusTitles(db, qotd.syllabus_codes) : {};
  const weakest = progress.skills.filter((s) => s.occurrences > 0).slice(0, 4);

  return (
    <div className="page container">
      <div className="row between" style={{ marginBottom: 22, alignItems: "flex-end" }}>
        <div>
          <div className="label">{new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" }).format(new Date())}</div>
          <h1 className="h1" style={{ marginTop: 6 }}>
            {greeting()}, <span className="script">{user.display_name}</span>
          </h1>
        </div>
        <div className="row">
          <div className="card flat bg-butter pastel" style={{ padding: "10px 16px" }}>
            <div className="label">Writing streak</div>
            <div style={{ fontWeight: 800, fontSize: "1.5rem" }}>{streak.days} day{streak.days === 1 ? "" : "s"} {streak.doneToday ? "✓" : ""}</div>
          </div>
        </div>
      </div>

      {sp.welcome && (
        <div className="note-box reveal" style={{ marginBottom: 20 }}>
          <strong>Welcome!</strong> Here is how it works: write your own answer first, rate it yourself, then see evidence-linked feedback. Guidance unlocks step by step — and two days later we check whether the fix holds on a new question.
        </div>
      )}
      {env.provider === "heuristic" && (
        <div className="note-box small" style={{ marginBottom: 20 }}>
          <strong>Demo mode.</strong> {HEURISTIC_NOTICE}
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", alignItems: "start" }}>
        <section className="card pastel bg-butter reveal" style={{ gridColumn: "span 1", position: "relative", overflow: "hidden" }} aria-labelledby="qotd-h">
          <Star size={34} color="var(--pink)" style={{ right: 16, top: 14 }} />
          <span className="sticker" style={{ background: "var(--surface)", color: "var(--ink)" }}>Question of the day</span>
          {qotd ? (
            <div className="stack" style={{ marginTop: 16 }}>
              <h2 id="qotd-h" style={{ fontSize: "1.35rem", fontWeight: 750, lineHeight: 1.3 }}>{qotd.text}</h2>
              <QuestionMeta q={qotd} />
              <div>
                <div className="label">Why this topic matters</div>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {qotd.priority_reasons.map((r) => <li key={r}>{r}</li>)}
                  {qotd.syllabus_codes.map((c) => syl[c] && <li key={c}>Syllabus: {syl[c]}</li>)}
                </ul>
                <p className="tiny muted" style={{ marginTop: 6 }}>Reasons for priority — not a prediction that it will be asked.</p>
              </div>
              <div className="row between">
                <ReviewBadge status={qotd.review_status} />
                <Link href={`/q/${qotd.slug}`} className="btn ink">Start writing →</Link>
              </div>
            </div>
          ) : (
            <p>No question is available yet.</p>
          )}
        </section>

        <section className="stack reveal" style={{ ["--d" as string]: 1 }}>
          {retests.length > 0 && (
            <div className="card pastel bg-mint">
              <div className="label">Transfer checks</div>
              <h3 className="h3" style={{ margin: "6px 0 10px" }}>Does the fix hold on a fresh question?</h3>
              <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "grid", gap: 8 }}>
                {retests.slice(0, 3).map((r) => (
                  <li key={r.id} className="row between">
                    <span>{r.skill_name}</span>
                    {r.is_due ? <span className="chip ink">Due now</span> : <span className="chip">Due {new Date(r.due_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="card pastel bg-lilac">
            <div className="row between">
              <div className="label">Your skill profile</div>
              <Link href="/progress" className="small" style={{ fontWeight: 700 }}>See all →</Link>
            </div>
            {weakest.length ? (
              <div className="stack" style={{ ["--gap" as string]: "10px", marginTop: 10 }}>
                {weakest.map((s) => (
                  <div key={s.skill_tag}>
                    <div className="row between small"><span style={{ fontWeight: 650 }}>{s.name}</span><span className="chip">{s.status_label}</span></div>
                    <div className="meter" style={{ marginTop: 6 }} role="img" aria-label={`${Math.round(s.mastery * 100)} percent`}>
                      <span style={{ width: `${Math.round(s.mastery * 100)}%`, ["--c" as string]: "var(--butter)" }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="small" style={{ marginBottom: 0 }}>Your weaknesses and strengths appear here after your first evaluated answer.</p>
            )}
          </div>
        </section>
      </div>

      {recs.length > 0 && (
        <section style={{ marginTop: 34 }}>
          <div className="row between" style={{ marginBottom: 14 }}>
            <h2 className="h2">Picked for you</h2>
            <Link href="/practice" className="btn sm">All questions →</Link>
          </div>
          <div className="grid grid-3">
            {recs.map((r, i) => (
              <div key={r.question.id} className="reveal" style={{ ["--d" as string]: i }}>
                <QuestionCard q={r.question} reason={r.reason} cta={r.kind === "retest" ? "Take the check" : "Write"} />
              </div>
            ))}
          </div>
        </section>
      )}

      <section style={{ marginTop: 34 }}>
        <h2 className="h2" style={{ marginBottom: 14 }}>Recent answers</h2>
        {recent.length ? (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Question</th><th>Paper</th><th>Kind</th><th>Status</th><th>AI estimate</th></tr></thead>
              <tbody>
                {recent.map((a) => (
                  <tr key={a.id}>
                    <td><Link href={`/attempt/${a.id}`}>{a.question_text.slice(0, 90)}{a.question_text.length > 90 ? "…" : ""}</Link></td>
                    <td className="mono">{a.paper_code}</td>
                    <td>{a.attempt_kind.replace("_", " ")}</td>
                    <td>{a.status.replace(/_/g, " ")}</td>
                    <td className="mono">{a.score !== null ? `${a.score.toFixed(1)} / ${a.max_marks}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Nothing yet — start with today&apos;s question.</p>
        )}
      </section>
    </div>
  );
}
