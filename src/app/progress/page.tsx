import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { currentUser } from "@/lib/http";
import { getProgress, weeklyReport } from "@/lib/services/skills";
import { LineChart } from "@/components/LineChart";
import { ShareButton } from "@/components/ShareButton";

export const metadata = { title: "Progress" };
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  holds_on_new_questions: "bg-mint",
  fixed_when_prompted: "bg-butter",
  recurring: "bg-coral",
  improving: "bg-sky",
  not_yet_observed: "bg-paper2",
};

export default async function Progress() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const db = getDb();
  const p = getProgress(db, user.id);
  const w = weeklyReport(db, user.id);
  const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const scorePts = p.timeline.map((t) => ({ x: fmtDate(t.created_at), y: t.pct * 100, label: `${t.paper_code} · ${t.attempt_kind.replace("_", " ")} · ${t.score.toFixed(1)}/${t.max}${t.provider === "heuristic" ? " (demo evaluator)" : ""}`, hollow: t.attempt_kind === "rewrite" }));
  const gapPts = p.timeline.filter((t) => t.self_gap !== null).map((t) => ({ x: fmtDate(t.created_at), y: t.self_gap as number, label: `${t.paper_code}: average gap between your self-check and the estimate` }));

  return (
    <div className="page container">
      <div className="label">Your skill profile</div>
      <h1 className="h1" style={{ margin: "6px 0 8px" }}>Repair is good. <span className="boxed mint">Transfer</span> is learning.</h1>
      <p className="muted" style={{ maxWidth: 720 }}>
        “Fixed when prompted” means you corrected an issue after feedback. “Holds on new questions” means it stayed fixed on a fresh question with no hints. Only the second shows the skill is yours.
      </p>

      {p.skills.length === 0 ? (
        <div className="card pastel bg-butter" style={{ marginTop: 20 }}>
          <h2 className="h3">Nothing to show yet</h2>
          <p>Write and evaluate your first answer — your profile builds from there.</p>
          <Link href="/today" className="btn ink">Go to today&apos;s question</Link>
        </div>
      ) : (
        <div className="grid grid-3" style={{ marginTop: 22 }}>
          {p.skills.map((s, i) => (
            <div key={s.skill_tag} className={`card pastel lift reveal ${STATUS_TONE[s.status]}`} style={{ ["--d" as string]: i % 6 }}>
              <div className="row between"><span className="label">{s.group.toLowerCase()}</span><span className="sticker" style={{ fontSize: ".7rem", padding: "3px 8px", background: "var(--surface)", color: "var(--ink)" }}>{s.status_label}</span></div>
              <h3 className="h3" style={{ margin: "10px 0" }}>{s.name}</h3>
              <div className="meter" role="img" aria-label={`Estimated mastery ${Math.round(s.mastery * 100)}%`}><span style={{ width: `${Math.round(s.mastery * 100)}%`, ["--c" as string]: "rgba(23,20,17,.78)" }} /></div>
              <dl className="spec" style={{ marginTop: 12, background: "rgba(255,255,255,.55)" }}>
                <div><dt>Seen</dt><dd>{s.occurrences}×</dd></div>
                <div><dt>Recent 6</dt><dd>{s.recent}</dd></div>
                <div><dt>Repaired</dt><dd>{s.repair_count}</dd></div>
                <div><dt>Transfer</dt><dd>{s.transfer_success_count}/{s.transfer_attempt_count}</dd></div>
              </dl>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-2" style={{ marginTop: 30 }}>
        <section className="card">
          <h2 className="h3" style={{ marginBottom: 10 }}>AI estimate over time</h2>
          <LineChart title="AI estimate as a percentage of maximum marks, per evaluated attempt" points={scorePts} yMax={100} yLabel="% of max (estimate) · hollow = rewrite" unit="pct" />
          <p className="tiny muted" style={{ marginBottom: 0 }}>Rewrites usually score higher — that is repair. Watch first attempts and transfer checks for real progress.</p>
        </section>
        <section className="card">
          <h2 className="h3" style={{ marginBottom: 10 }}>How well you judge your own answers</h2>
          <LineChart title="Average gap in bands between your self-check and the estimate" points={gapPts} yMax={4} yLabel="Gap in bands (lower is better)" unit="decimal" />
          <p className="tiny muted" style={{ marginBottom: 0 }}>Do the 30-second self-check before feedback to build this line.</p>
        </section>
      </div>

      <div className="grid grid-2" style={{ marginTop: 30, alignItems: "start" }}>
        <section className="card">
          <h2 className="h3">Error ledger</h2>
          {p.ledger.length ? (
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table className="t">
                <thead><tr><th>Weakness</th><th>Times</th><th>Repaired</th><th>Held on new Q</th><th>Recurred on new Q</th></tr></thead>
                <tbody>{p.ledger.map((l) => <tr key={l.skill_tag}><td>{l.name}</td><td className="mono">{l.total}</td><td className="mono">{l.repaired}</td><td className="mono">{l.transferred}</td><td className="mono">{l.transfer_failed}</td></tr>)}</tbody>
              </table>
            </div>
          ) : <p className="small muted">Empty for now.</p>}
        </section>
        <section className="card pastel bg-sky">
          <div className="label">Weekly report · {w.period.from} → {w.period.to}</div>
          <dl className="spec" style={{ margin: "12px 0", background: "rgba(255,255,255,.6)" }}>
            <div><dt>Answers</dt><dd>{w.attempts}</dd></div>
            <div><dt>Avg estimate</dt><dd>{w.average_pct !== null ? `${Math.round(w.average_pct * 100)}%` : "—"}</dd></div>
            <div><dt>Transfer checks</dt><dd>{w.transfers.filter((t) => t.status === "passed").length}/{w.transfers.length} held</dd></div>
          </dl>
          <p className="small"><strong>Holding on new questions:</strong> {w.improved.join(", ") || "—"}</p>
          <p className="small"><strong>Still recurring:</strong> {w.recurring.join(", ") || "—"}</p>
          <p className="small"><strong>Next focus:</strong> {w.next_focus.join(", ") || "Keep writing daily."}</p>
          {w.calibration && <p className="small">Self-check gap: {w.calibration.earlier.toFixed(1)} → {w.calibration.recent.toFixed(1)} bands.</p>}
          <ShareButton />
        </section>
      </div>

      {p.retests.length > 0 && (
        <section style={{ marginTop: 30 }}>
          <h2 className="h2" style={{ marginBottom: 12 }}>Upcoming transfer checks</h2>
          <div className="grid grid-3">
            {p.retests.map((r) => (
              <div key={r.id} className="card flat">
                <div className="label">{r.is_due ? "Due now" : `Due ${new Date(r.due_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`}</div>
                <p style={{ fontWeight: 700, margin: "6px 0" }}>{r.skill_name}</p>
                {r.is_due && r.question_id && <Link href={`/q/${r.question_id}`} className="btn sm ink">Take it</Link>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
