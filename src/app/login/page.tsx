import { redirect } from "next/navigation";
import { currentPrincipal } from "@/modules/identity/session";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await currentPrincipal()) redirect("/");
  return <main className="login"><LoginForm /></main>;
}
