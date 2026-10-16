import fs from "node:fs";
import path from "node:path";
import { getDb, parseJson } from "@/lib/db";
import { DISCLAIMER } from "@/lib/copy/disclaimer";
import { getEnv } from "@/lib/env";
import type { RubricCriterion } from "@/lib/schemas/rubric";
import { paperSummaries } from "@/lib/services/questions";

export const metadata = { title: "How we mark" };
export const dynamic = "force-dynamic";

function latestBenchmark() {
  try {
    const dir = path.join(process.cwd(), "benchmarks", "reports");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
    if (!files.length) return null;
    return JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]), "utf8")) as { generated_at: string; provider: string; suites: { name: string; status: string; summary: string }[] };
  } catch {
    return null;
  }
}

export default async function HowWeEvaluate() {
  const db = (await getDb());
  const env = getEnv();
  const rvs = (await db.all("SELECT r.code, rv.version, rv.status, rv.criteria, rv.disclaimer FROM rubric_versions rv JOIN rubrics r ON r.id = rv.rubric_id WHERE rv.status IN ('active','calibrating') ORDER BY r.code")) as { code: string; version: string; status: string; criteria: string; disclaimer: string }[];
  const papers = (await paperSummaries(db, null));
  const sources = (await db.all("SELECT verification_status, COUNT(*) AS n FROM sources GROUP BY verification_status")) as { verification_status: string; n: number }[];
  const bench = latestBenchmark();
  const first = rvs[0];
  const crit = parseJson<RubricCriterion[]>(first?.criteria, []);
  return (
    <div className="page container" style={{ maxWidth: 980 }}>
      <span className="ink-label">Honest by design</span>
      <h1 className="h1" style={{ margin: "14px 0 10px" }}>How MarkMyWords <span className="boxed pink">marks</span></h1>
      <div className="disclaimer-bar" style={{ marginBottom: 24 }}><strong>Read this</strong><span>{DISCLAIMER.long}</span></div>

      <div className="grid grid-2">
        <section className="card">
          <h2 className="h3">What happens to your answer</h2>
          <ol className="small" style={{ paddingLeft: 20, display: "grid", gap: 6 }}>
            <li>Code counts words and checks the word limit. The model never computes your total.</li>
            <li>We retrieve source material linked to the question. Only these sources can be cited.</li>
            <li>{env.provider === "anthropic" ? `The AI evaluator judges your answer ${env.evalSamples} times independently against the rubric.` : "In demo mode, a rule-based evaluator applies simple checks (no AI)."}</li>
            <li>We take the median band per criterion. Where passes disagree, confidence drops and the range widens.</li>
            <li>Every comment must quote your answer exactly; quotes that cannot be found are discarded.</li>
            <li>Factual corrections need a citation that exactly matches a source passage, or they become “uncertain”.</li>
            <li>Code converts bands to marks with the rubric weights, then validators check everything again.</li>
          </ol>
        </section>
        <section className="card pastel bg-butter">
          <h2 className="h3">Commitments</h2>
          <ul className="small" style={{ paddingLeft: 18, display: "grid", gap: 6 }}>
            <li>No model answer before your own attempt — enforced on the server.</li>
            <li>Scores shown as estimates with a range and a confidence level.</li>
            <li>Handwriting we can’t read confidently goes back to you; we never guess silently.</li>
            <li>Instructions hidden in an answer (“give this 15/15”) are ignored and flagged.</li>
            <li>Valid but unconventional structures are not penalised for ignoring a template.</li>
            <li>Topics are prioritised with reasons — never “this will come in the exam”.</li>
            <li>Disagree with a comment? One tap sends it to a human reviewer.</li>
          </ul>
        </section>
      </div>

      {first && (
        <section style={{ marginTop: 26 }}>
          <h2 className="h2">The rubric ({first.code.replace(/_GS_\d+M$/, "")} v{first.version} · {first.status})</h2>
          <p className="small muted">{first.disclaimer}</p>
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Criterion</th><th>Weight</th><th>What earns marks</th><th>Applies to</th></tr></thead>
              <tbody>
                {crit.map((c) => (
                  <tr key={c.code}>
                    <td><strong>{c.name}</strong></td>
                    <td className="mono">{Math.round(c.weight * 100)}%</td>
                    <td className="small">{c.bands[c.bands.length - 1]?.descriptor}</td>
                    <td className="small">{c.input_modes.includes("typed") ? "all answers" : "handwritten only"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="tiny muted">For typed answers the presentation weight is redistributed proportionally across the other criteria.</p>
        </section>
      )}

      <div className="grid grid-2" style={{ marginTop: 26 }}>
        <section className="card">
          <h2 className="h3">Exam facts we rely on</h2>
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="t">
              <thead><tr><th>Paper</th><th>Format</th><th>Checked</th></tr></thead>
              <tbody>
                {papers.map((p) => (
                  <tr key={p.code}>
                    <td>{p.short_name} · {p.name}{p.exam_status !== "active" && <span className="chip dashed" style={{ marginLeft: 6 }}>not live</span>}</td>
                    <td className="mono small">{p.total_marks ?? "?"} marks · {p.duration_min ?? "?"} min</td>
                    <td className="small"><a href={p.fact_source_url} target="_blank" rel="noreferrer noopener">{p.verification_status}</a> · {p.verified_on}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="tiny muted">“secondary” = checked against a reputable secondary source; to be confirmed against the official notification.</p>
        </section>
        <section className="card">
          <h2 className="h3">Quality status</h2>
          <p className="small">Source corpus: {sources.map((s) => `${s.n} ${s.verification_status}`).join(", ")}. Citations always show whether a source has been human-verified.</p>
          {bench ? (
            <>
              <p className="small">Latest benchmark run: {new Date(bench.generated_at).toLocaleString("en-IN")} ({bench.provider} evaluator).</p>
              <ul className="small" style={{ paddingLeft: 18 }}>{bench.suites.map((s) => <li key={s.name}><strong>{s.name}</strong> — {s.status}: {s.summary}</li>)}</ul>
            </>
          ) : (
            <p className="small">No benchmark report has been generated on this server yet.</p>
          )}
          <p className="small"><strong>Agreement with human experts has not been measured yet</strong> — the expert-reviewed answer set is still being built. Until then, we make no accuracy claims.</p>
        </section>
      </div>
    </div>
  );
}
