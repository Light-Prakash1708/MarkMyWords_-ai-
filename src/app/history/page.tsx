import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { currentUser } from "@/lib/http";
import { listAttempts } from "@/lib/services/attempts";

export const metadata = { title: "History" };
export const dynamic = "force-dynamic";

export default async function History() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const rows = listAttempts(getDb(), user.id, 200);
  return (
    <div className="page container">
      <h1 className="h1" style={{ marginBottom: 18 }}>Every answer you&apos;ve written</h1>
      {rows.length ? (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Date</th><th>Question</th><th>Paper</th><th>Kind</th><th>Mode</th><th>Status</th><th>AI estimate</th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="mono small">{new Date(a.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                  <td><Link href={`/attempt/${a.id}`}>{a.question_text.slice(0, 100)}{a.question_text.length > 100 ? "…" : ""}</Link></td>
                  <td className="mono">{a.paper_code}</td>
                  <td>{a.attempt_kind.replace("_", " ")}</td>
                  <td>{a.mode}</td>
                  <td>{a.status.replace(/_/g, " ")}</td>
                  <td className="mono">{a.score !== null ? `${a.score.toFixed(1)} / ${a.max_marks}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">No answers yet. <Link href="/today">Start with today&apos;s question</Link>.</p>
      )}
    </div>
  );
}
