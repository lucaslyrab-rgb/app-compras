"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { changeOwnPasswordAction } from "@/modules/identity/actions";

export function ChangePasswordForm() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!currentPassword) {
      setError("Informe a senha atual.");
      return;
    }
    if (!newPassword) {
      setError("Informe a nova senha.");
      return;
    }
    if (newPassword !== passwordConfirmation) {
      setError("As senhas não coincidem.");
      return;
    }
    if (currentPassword === newPassword) {
      setError("A nova senha deve ser diferente da senha atual.");
      return;
    }

    startTransition(async () => {
      const result = await changeOwnPasswordAction({
        currentPassword,
        newPassword,
        passwordConfirmation,
      });

      if (result.status === "error") {
        setError(result.message);
      } else {
        router.push("/login?changed=1");
      }
    });
  }

  return (
    <div
      style={{
        maxWidth: "460px",
        width: "100%",
        background: "var(--color-surface, #ffffff)",
        border: "1px solid var(--color-border, #e2e8f0)",
        borderRadius: "12px",
        padding: "2.5rem 2rem",
        boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05)",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
        <Image
          src="/brand/MS-H.png"
          alt="MultiShow FLV"
          width={170}
          height={43}
          priority
          style={{ margin: "0 auto", height: "auto" }}
        />
        <h1
          style={{
            fontSize: "1.25rem",
            fontWeight: 700,
            marginTop: "1.25rem",
            marginBottom: "0.25rem",
            color: "var(--color-text, #1e293b)",
          }}
        >
          Minha senha
        </h1>
        <p
          style={{
            fontSize: "0.875rem",
            color: "var(--color-text-muted, #64748b)",
          }}
        >
          Altere sua senha de acesso ao sistema
        </p>
      </div>

      <form onSubmit={handleSubmit} className="stack" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {error ? (
          <p className="error" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        ) : null}

        <div className="field">
          <label
            htmlFor="current-password"
            style={{ display: "block", marginBottom: "0.375rem", fontWeight: 600, fontSize: "0.875rem" }}
          >
            Senha atual
          </label>
          <input
            id="current-password"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            disabled={isPending}
            style={{ fontSize: "16px" }}
          />
        </div>

        <div className="field">
          <label
            htmlFor="new-password"
            style={{ display: "block", marginBottom: "0.375rem", fontWeight: 600, fontSize: "0.875rem" }}
          >
            Nova senha
          </label>
          <input
            id="new-password"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            disabled={isPending}
            style={{ fontSize: "16px" }}
          />
          <p style={{ fontSize: "0.75rem", color: "var(--color-text-muted, #64748b)", marginTop: "0.25rem" }}>
            Mínimo 8 caracteres, com pelo menos uma letra e um número.
          </p>
        </div>

        <div className="field">
          <label
            htmlFor="password-confirmation"
            style={{ display: "block", marginBottom: "0.375rem", fontWeight: 600, fontSize: "0.875rem" }}
          >
            Confirmar nova senha
          </label>
          <input
            id="password-confirmation"
            name="passwordConfirmation"
            type="password"
            autoComplete="new-password"
            required
            value={passwordConfirmation}
            onChange={(e) => setPasswordConfirmation(e.target.value)}
            disabled={isPending}
            style={{ fontSize: "16px" }}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
          <button
            type="submit"
            className="btn"
            disabled={isPending}
            style={{ width: "100%", padding: "0.75rem", fontWeight: 600, cursor: isPending ? "not-allowed" : "pointer" }}
          >
            {isPending ? "Alterando senha…" : "Alterar senha"}
          </button>
          <Link
            href="/"
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
            Voltar
          </Link>
        </div>
      </form>
    </div>
  );
}
