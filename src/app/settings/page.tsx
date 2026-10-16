import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { currentUser } from "@/lib/http";
import { listExams } from "@/lib/services/questions";
import { getConsents } from "@/lib/services/users";
import { ConsentToggles, DeleteAccount, ProfileForm } from "@/components/SettingsForms";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function Settings() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const db = getDb();
  return (
    <div className="page container" style={{ maxWidth: 860 }}>
      <h1 className="h1" style={{ marginBottom: 20 }}>Settings</h1>
      <div className="stack" style={{ ["--gap" as string]: "22px" }}>
        <section className="card">
          <h2 className="h3" style={{ marginBottom: 12 }}>Profile</h2>
          <ProfileForm name={user.display_name} exam={user.target_exam_code} exams={listExams(db)} />
        </section>
        <section className="card">
          <h2 className="h3">Privacy</h2>
          <p className="small muted">Your answers are private by default. Nothing below is on unless you switch it on, and you can switch it off at any time.</p>
          <ConsentToggles initial={getConsents(db, user.id)} />
        </section>
        <section className="card">
          <h2 className="h3">Your data</h2>
          <p className="small">Download everything we hold about you as JSON: answers, transcripts, evaluations, skill profile and consents.</p>
          <a className="btn" href="/api/me/export">Download my data</a>
        </section>
        <section className="card" style={{ borderColor: "var(--red-pen)" }}>
          <h2 className="h3">Delete account</h2>
          <DeleteAccount email={user.email} />
        </section>
      </div>
    </div>
  );
}
