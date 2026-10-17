import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { AuthShell } from "@/components/AuthShell";
import { currentUser } from "@/lib/http";
import { isGuest } from "@/lib/services/trial";

export const metadata = { title: "Log in" };

export default async function Login() {
  const user = await currentUser();
  if (user && !isGuest(user)) redirect("/today");
  return (
    <AuthShell kicker="Welcome back" title={<>Pick up your <span className="boxed butter">pen</span></>}>
      <AuthForm mode="login" />
    </AuthShell>
  );
}
