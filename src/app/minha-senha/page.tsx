import { requirePrincipal } from "@/modules/identity/session";
import { ChangePasswordForm } from "./change-password-form";

export const dynamic = "force-dynamic";

export default async function MinhaSenhaPage() {
  await requirePrincipal();

  return (
    <main
      className="minha-senha-page"
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem 1rem",
        background: "var(--color-bg, #f8fafc)",
      }}
    >
      <ChangePasswordForm />
    </main>
  );
}
