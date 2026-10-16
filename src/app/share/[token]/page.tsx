import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { readShareLink } from "@/lib/services/skills";

export const metadata = { title: "Weekly progress", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function Share({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = (await readShareLink(await getDb(), token));
  if (!data) notFound();
  const w = data.report;
  return (
    <div className="grid-paper" style={{ ["--bgc" as string]: "var(--mint)", minHeight: "calc(100vh - 60px)" }}>
      <div className="container page" style={{ maxWidth: 720 }}>
        <div className="signboard">
          <div className="label" style={{ color: "rgba(23,20,17,.7)" }}>{w.period.from} → {w.period.to}</div>
          <h1 className="h1" style={{ marginTop: 8 }}>{data.name}&apos;s writing week</h1>
        </div>
        <div className="card" style={{ marginTop: 24 }}>
          <dl className="spec">
            <div><dt>Answers written</dt><dd>{w.attempts}</dd></div>
            <div><dt>Transfer checks held</dt><dd>{w.transfers.filter((t) => t.status === "passed").length}/{w.transfers.length}</dd></div>
          </dl>
          <p><strong>Skills holding on new questions:</strong> {w.improved.join(", ") || "—"}</p>
          <p><strong>Still working on:</strong> {w.recurring.join(", ") || w.next_focus.join(", ") || "—"}</p>
          <p className="tiny muted">Shared from MarkMyWords. This summary contains no answer text. Scores are AI estimates, not official marks.</p>
        </div>
      </div>
    </div>
  );
}
