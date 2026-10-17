import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { AuthShell } from "@/components/AuthShell";
import { currentUser } from "@/lib/http";
import { getDb } from "@/lib/db";
import { listExams } from "@/lib/services/questions";
import { isGuest } from "@/lib/services/trial";

export const metadata = { title: "Create account" };

export default async function Signup() {
  const user = await currentUser();
  const guest = isGuest(user);
  if (user && !guest) redirect("/today");
  return (
    <AuthShell
      kicker={guest ? "Keep your trial answers" : "Free to start"}
      title={guest ? <>Save your work. <span className="boxed pink">Keep</span> improving.</> : <>Write first. <span className="boxed pink">Improve</span> for real.</>}
    >
      <AuthForm mode="signup" exams={(await listExams(await getDb())).map((e) => ({ code: e.code, label: e.stage === "preview" ? `${e.name} (preview)` : e.name, active: e.status === "active" }))} />
    </AuthShell>
  );
}
