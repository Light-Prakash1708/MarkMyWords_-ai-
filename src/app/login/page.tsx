import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { AuthShell } from "@/components/AuthShell";
import { currentUser } from "@/lib/http";

export const metadata = { title: "Log in" };

export default async function Login() {
  if (await currentUser()) redirect("/today");
  return (
    <AuthShell kicker="Welcome back" title={<>Pick up your <span className="boxed butter">pen</span></>}>
      <AuthForm mode="login" />
    </AuthShell>
  );
}
