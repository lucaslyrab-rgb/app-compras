"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { logoutAction } from "@/app/login/actions";

export type StoreNavProps = {
  storeName: string;
  hasOrderPermission?: boolean;
  hasConferencePermission?: boolean;
  hasLossPermission?: boolean;
  showHubOnMount?: boolean;
};

export function StoreNavigation({
  storeName,
  hasOrderPermission = true,
  hasConferencePermission = true,
  hasLossPermission = true,
  showHubOnMount = false,
}: StoreNavProps) {
  const pathname = usePathname() ?? "";
  const [hubOpen, setHubOpen] = useState(showHubOnMount);

  return (
    <>
      <header className="topbar no-print" style={{ borderBottom: "1px solid #cbd5e1", background: "#ffffff" }}>
        <div className="topbar__inner" style={{ maxWidth: 1200, margin: "0 auto", padding: "8px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Link href="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
              <Image src="/brand/MS-H.png" alt="MultiShow FLV" width={140} height={35} priority style={{ objectFit: "contain" }} />
              <div>
                <h1 style={{ fontSize: 15, fontWeight: 800, margin: 0, color: "#004737", lineHeight: 1.1 }}>MultiShow FLV</h1>
                <p style={{ fontSize: 11, color: "#64748b", margin: 0 }}>{storeName}</p>
              </div>
            </Link>

            <button
              type="button"
              onClick={() => setHubOpen(true)}
              className="btn btn--secondary"
              style={{ fontSize: 12, padding: "4px 10px", minHeight: 32, borderRadius: 6, fontWeight: 700 }}
              title="Abrir Menu de Atividades da Loja"
            >
              ☰ Módulos
            </button>
          </div>

          {/* Abas Rápidas no Topo */}
          <nav style={{ display: "flex", gap: 6, alignItems: "center" }} aria-label="Navegação da loja">
            {hasOrderPermission && (
              <Link
                href="/"
                className="btn"
                style={{
                  fontSize: 12,
                  padding: "6px 12px",
                  minHeight: 34,
                  borderRadius: 6,
                  fontWeight: pathname === "/" ? 800 : 600,
                  background: pathname === "/" ? "#004737" : "#f1f5f9",
                  color: pathname === "/" ? "#ffffff" : "#334155",
                  border: pathname === "/" ? "none" : "1px solid #cbd5e1",
                  textDecoration: "none",
                }}
              >
                📝 Pedido
              </Link>
            )}

            {hasConferencePermission && (
              <Link
                href="/conferencia"
                className="btn"
                style={{
                  fontSize: 12,
                  padding: "6px 12px",
                  minHeight: 34,
                  borderRadius: 6,
                  fontWeight: pathname.startsWith("/conferencia") ? 800 : 600,
                  background: pathname.startsWith("/conferencia") ? "#004737" : "#f1f5f9",
                  color: pathname.startsWith("/conferencia") ? "#ffffff" : "#334155",
                  border: pathname.startsWith("/conferencia") ? "none" : "1px solid #cbd5e1",
                  textDecoration: "none",
                }}
              >
                ⚖️ Conferência
              </Link>
            )}

            {hasLossPermission && (
              <Link
                href="/perdas"
                className="btn"
                style={{
                  fontSize: 12,
                  padding: "6px 12px",
                  minHeight: 34,
                  borderRadius: 6,
                  fontWeight: pathname.startsWith("/perdas") ? 800 : 600,
                  background: pathname.startsWith("/perdas") ? "#004737" : "#f1f5f9",
                  color: pathname.startsWith("/perdas") ? "#ffffff" : "#334155",
                  border: pathname.startsWith("/perdas") ? "none" : "1px solid #cbd5e1",
                  textDecoration: "none",
                }}
              >
                🗑️ Perdas
              </Link>
            )}

            <div style={{ marginLeft: 8, display: "flex", gap: 6 }}>
              <Link
                href="/minha-senha"
                className="btn btn--secondary"
                style={{ fontSize: 11, padding: "4px 8px", minHeight: 32, borderRadius: 6 }}
              >
                Senha
              </Link>
              <form action={logoutAction}>
                <button
                  type="submit"
                  className="btn btn--secondary"
                  style={{ fontSize: 11, padding: "4px 8px", minHeight: 32, borderRadius: 6 }}
                >
                  Sair
                </button>
              </form>
            </div>
          </nav>
        </div>
      </header>

      {/* Modal / Hub Operacional das Lojas (Seção 7.2) */}
      {hubOpen && (
        <div
          role="presentation"
          onClick={() => setHubOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.65)",
            backdropFilter: "blur(2px)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="hub-title"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#ffffff",
              borderRadius: 14,
              maxWidth: 420,
              width: "100%",
              padding: 24,
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h2 id="hub-title" style={{ fontSize: 18, fontWeight: 800, margin: 0, color: "#0f172a" }}>
                  Acesso Operacional
                </h2>
                <p style={{ fontSize: 12, color: "#64748b", margin: "2px 0 0" }}>{storeName}</p>
              </div>
              <button
                type="button"
                onClick={() => setHubOpen(false)}
                style={{ background: "transparent", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {hasOrderPermission && (
                <Link
                  href="/"
                  onClick={() => setHubOpen(false)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "14px 16px",
                    borderRadius: 10,
                    background: pathname === "/" ? "#ecfdf5" : "#f8fafc",
                    border: pathname === "/" ? "2px solid #006b4f" : "1px solid #e2e8f0",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <div style={{ fontSize: 26 }}>📝</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: 14, color: "#0f172a" }}>Fazer Pedido</div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>Lançar estoque e pedidos para o ciclo</div>
                  </div>
                  <div style={{ fontSize: 18, color: "#006b4f" }}>❯</div>
                </Link>
              )}

              {hasConferencePermission && (
                <Link
                  href="/conferencia"
                  onClick={() => setHubOpen(false)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "14px 16px",
                    borderRadius: 10,
                    background: pathname.startsWith("/conferencia") ? "#ecfdf5" : "#f8fafc",
                    border: pathname.startsWith("/conferencia") ? "2px solid #006b4f" : "1px solid #e2e8f0",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <div style={{ fontSize: 26 }}>⚖️</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: 14, color: "#0f172a" }}>Conferência de Entrega</div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>Pesar mercadorias do caminhão (em KG)</div>
                  </div>
                  <div style={{ fontSize: 18, color: "#006b4f" }}>❯</div>
                </Link>
              )}

              {hasLossPermission && (
                <Link
                  href="/perdas"
                  onClick={() => setHubOpen(false)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "14px 16px",
                    borderRadius: 10,
                    background: pathname.startsWith("/perdas") ? "#ecfdf5" : "#f8fafc",
                    border: pathname.startsWith("/perdas") ? "2px solid #006b4f" : "1px solid #e2e8f0",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <div style={{ fontSize: 26 }}>🗑️</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: 14, color: "#0f172a" }}>Lançamento de Perdas</div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>Registrar quebras e descartes no expediente</div>
                  </div>
                  <div style={{ fontSize: 18, color: "#006b4f" }}>❯</div>
                </Link>
              )}
            </div>

            <p style={{ fontSize: 11, color: "#94a3b8", textAlign: "center", margin: "4px 0 0" }}>
              Navegue entre os módulos a qualquer momento pelo menu superior.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
