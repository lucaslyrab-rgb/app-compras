import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { logoutAction } from "@/app/login/actions";
import { hasOperationalRoute } from "@/modules/identity";
import { requirePrincipal } from "@/modules/identity/session";

export const dynamic = "force-dynamic";

export default async function SemAcessoPage() {
  const principal = await requirePrincipal();

  if (hasOperationalRoute(principal)) {
    redirect("/");
  }

  return (
    <main
      className="no-access-page"
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
      <div
        style={{
          maxWidth: "460px",
          width: "100%",
          background: "var(--color-surface, #ffffff)",
          border: "1px solid var(--color-border, #e2e8f0)",
          borderRadius: "12px",
          padding: "2.5rem 2rem",
          boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05)",
          textAlign: "center",
        }}
      >
        <div style={{ marginBottom: "1.5rem" }}>
          <Image
            src="/brand/MS-H.png"
            alt="MultiShow FLV"
            width={170}
            height={43}
            priority
            style={{ margin: "0 auto", height: "auto" }}
          />
        </div>
        <h1
          style={{
            fontSize: "1.25rem",
            fontWeight: 700,
            marginBottom: "0.75rem",
            color: "var(--color-text, #1e293b)",
          }}
        >
          Sem acesso operacional
        </h1>
        <p
          style={{
            fontSize: "0.95rem",
            color: "var(--color-text-muted, #64748b)",
            lineHeight: 1.5,
            marginBottom: "1.75rem",
          }}
        >
          Seu usuário está autenticado, mas no momento não possui permissões para
          acessar nenhuma área operacional do sistema. Entre em contato com um
          administrador.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <Link
            href="/minha-senha"
            className="btn btn--secondary"
            style={{
              width: "100%",
              padding: "0.75rem",
              fontWeight: 600,
              textAlign: "center",
              textDecoration: "none",
              display: "block",
            }}
          >
            Minha senha
          </Link>
          <form action={logoutAction}>
            <button
              type="submit"
              className="btn btn--secondary"
              style={{
                width: "100%",
                padding: "0.75rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Sair da conta
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
