import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { AuthShell } from "@/components/AuthShell";
import { currentUser } from "@/lib/http";
import { getDb } from "@/lib/db";
import { listExams } from "@/lib/services/questions";

export const metadata = { title: "Create account" };

export default async function Signup() {
  if (await currentUser()) redirect("/today");
  return (
    <AuthShell kicker="Free to start" title={<>Write first. <span className="boxed pink">Improve</span> for real.</>}>
      <AuthForm mode="signup" exams={(await listExams(await getDb())).map((e) => ({ code: e.code, label: e.name, active: e.status === "active" }))} />
    </AuthShell>
  );
}
