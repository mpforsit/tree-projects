import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getSessionUser, isEntraConfigured } from "@/lib/auth";

export default async function LoginPage() {
  const user = await getSessionUser(await headers());
  if (user) redirect("/");
  return <LoginForm entra={isEntraConfigured()} />;
}
