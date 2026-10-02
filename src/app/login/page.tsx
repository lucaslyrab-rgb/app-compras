import { redirect } from "next/navigation";
import { currentPrincipal } from "@/modules/identity/session";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ changed?: string }>;
}) {
  if (await currentPrincipal()) redirect("/");
  const params = await searchParams;
  const changed = params?.changed === "1";
  return (
    <main className="login">
      <LoginForm changed={changed} />
    </main>
  );
}
