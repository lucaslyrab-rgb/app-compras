"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import "./store-navigation.css";
import { logoutAction } from "@/app/login/actions";

export type StoreNavProps = {
  storeName: string;
  /** Mantidos por compatibilidade: a escolha da atividade agora fica no Início. */
  hasOrderPermission?: boolean;
  hasConferencePermission?: boolean;
  hasLossPermission?: boolean;
};

/** Nome da tela atual da loja, exibido no topo de forma informativa. */
export function currentStoreModule(pathname: string): { icon: string; label: string } {
  if (pathname.startsWith("/conferencia")) return { icon: "⚖️", label: "Conferência de Entrega" };
  if (pathname.startsWith("/perdas")) return { icon: "🗑️", label: "Lançamento de Perdas" };
  if (pathname.startsWith("/historico")) return { icon: "📚", label: "Histórico de Pedidos" };
  if (pathname.startsWith("/inicio")) return { icon: "☰", label: "Início" };
  if (pathname.startsWith("/minha-senha")) return { icon: "🔑", label: "Minha Senha" };
  return { icon: "📝", label: "Pedido da Loja" };
}

export function StoreNavigation({ storeName }: StoreNavProps) {
  const pathname = usePathname() ?? "";
  const currentModule = currentStoreModule(pathname);
  const isHome = pathname.startsWith("/inicio");
  const shortName = storeName.replace(/^MultiShow\s+/i, "");
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!accountOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) setAccountOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [accountOpen]);

  return (
    <header className="store-header no-print">
      <div className="store-header__bar">
        {isHome ? (
          <Image
            src="/brand/MS-H.png"
            alt="MultiShow"
            width={104}
            height={26}
            priority
            className="store-header__logo"
          />
        ) : (
          <Link href="/inicio" className="store-header__home" aria-label="Voltar ao Início">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            <span>Início</span>
          </Link>
        )}

        <p className="store-header__title">
          <strong>
            <span className="visually-hidden">Tela atual: </span>
            {currentModule.label}
          </strong>
          <span>{shortName}</span>
        </p>

        <div className="store-header__account" ref={accountRef}>
          <button
            type="button"
            className="store-header__account-btn"
            aria-label="Conta"
            aria-haspopup="true"
            aria-expanded={accountOpen}
            onClick={() => setAccountOpen((open) => !open)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
            </svg>
          </button>
          {accountOpen ? (
            <div className="store-header__menu">
              <span className="store-header__menu-store">{storeName}</span>
              <Link href="/minha-senha" onClick={() => setAccountOpen(false)}>Minha senha</Link>
              <form action={logoutAction}>
                <button type="submit">Sair</button>
              </form>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
