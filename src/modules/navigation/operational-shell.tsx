"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { logoutAction } from "@/app/login/actions";
import type { Permission, Role } from "@/modules/identity";

type IconName =
  | "home" | "list" | "receipt" | "truck" | "building" | "trash" | "box"
  | "tag" | "gear" | "users" | "clipboard" | "key" | "logout";

type NavItem = { href: string; label: string; icon: IconName; permission?: Permission };

/** Ícones de traço, todos no mesmo estilo (identidade visual nov/2026). */
const ICON_PATHS: Record<IconName, string[]> = {
  home: ["M3 11l9-7 9 7", "M5 10v10h14V10", "M10 20v-6h4v6"],
  list: ["M8 6h12", "M8 12h12", "M8 18h12", "M4 6h.01", "M4 12h.01", "M4 18h.01"],
  receipt: ["M6 3h12v18l-3-2-3 2-3-2-3 2z", "M9 8h6", "M9 12h6"],
  truck: ["M3 6h11v10H3z", "M14 10h4l3 3v3h-7", "M7 19a2 2 0 100-4 2 2 0 000 4z", "M17 19a2 2 0 100-4 2 2 0 000 4z"],
  building: ["M4 21V5l8-2v18", "M12 9l8 2v10", "M8 8h.01", "M8 12h.01", "M8 16h.01", "M16 14h.01", "M16 17h.01", "M3 21h18"],
  trash: ["M4 7h16", "M10 11v6", "M14 11v6", "M6 7l1 13h10l1-13", "M9 7V4h6v3"],
  box: ["M21 8l-9-5-9 5 9 5 9-5z", "M3 8v8l9 5 9-5V8", "M12 13v8"],
  tag: ["M3 12V4h8l10 10-8 8z", "M7.5 7.5h.01"],
  gear: ["M12 15a3 3 0 100-6 3 3 0 000 6z", "M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"],
  users: ["M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2", "M9 11a4 4 0 100-8 4 4 0 000 8z", "M22 21v-2a4 4 0 00-3-3.9", "M16 3.1a4 4 0 010 7.8"],
  clipboard: ["M9 4h6v3H9z", "M9 5H6v16h12V5h-3", "M9 12l2 2 4-4"],
  key: ["M15 7a3 3 0 11-3 3", "M12 10l-9 9", "M6 16l2 2", "M9 13l2 2"],
  logout: ["M15 4h4v16h-4", "M10 8l-4 4 4 4", "M6 12h11"],
};

function NavIcon({ name }: { name: IconName }) {
  return (
    <svg className="ops-nav-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICON_PATHS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

const buyerItems: (NavItem & { permission: Permission })[] = [
  { href: "/comprador/consolidado", label: "Consolidado", icon: "list", permission: "compras:consolidado" },
  { href: "/comprador/custos", label: "Lançamento de Custos", icon: "receipt", permission: "compras:custos" },
  { href: "/comprador/destinacao", label: "Destinação", icon: "truck", permission: "compras:destinacao" },
  { href: "/comprador/fornecedores", label: "Fornecedores", icon: "building", permission: "compras:fornecedores" },
  { href: "/comprador/perdas", label: "Perdas FLV", icon: "trash", permission: "perdas:consultar" },
];
const managerItems: (NavItem & { permission: Permission })[] = [
  { href: "/gestor/produtos", label: "Produtos", icon: "box", permission: "gestor:produtos" },
  { href: "/gestor/precificacao", label: "Precificação", icon: "tag", permission: "gestor:precificacao" },
  { href: "/gestor/fornecedores", label: "Fornecedores", icon: "building", permission: "gestor:fornecedores" },
  { href: "/gestor/configuracoes", label: "Configurações", icon: "gear", permission: "gestor:configuracoes" },
  { href: "/gestor/usuarios", label: "Usuários", icon: "users", permission: "gestor:usuarios" },
  { href: "/gestor/perdas", label: "Perdas FLV", icon: "trash", permission: "perdas:consultar" },
];

// Fase 6: o Fechamento integrado aparece uma única vez, para Gestor e CPD.
const controlItems: (NavItem & { permission: Permission })[] = [
  { href: "/fechamento", label: "Fechamento integrado", icon: "clipboard", permission: "fechamento:consultar" },
];

/**
 * Cada tela aparece uma única vez no menu: quem tem os dois perfis vê
 * Fornecedores no grupo Gestor (página com mais recursos) e Perdas FLV no
 * grupo Comprador.
 */
export function visibleMenuGroups(permissions: readonly Permission[]) {
  const can = (item: { permission: Permission }) => permissions.includes(item.permission);
  const manager = managerItems.filter(can);
  const managerLabels = new Set(manager.map((item) => item.label));
  const buyer = buyerItems.filter(can).filter((item) => item.label !== "Fornecedores" || !managerLabels.has("Fornecedores"));
  const buyerLabels = new Set(buyer.map((item) => item.label));
  return {
    buyer,
    manager: manager.filter((item) => item.label !== "Perdas FLV" || !buyerLabels.has("Perdas FLV")),
    control: controlItems.filter(can),
  };
}

function NavLink({ item, close }: { item: NavItem; close: () => void }) {
  const pathname = usePathname();
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  return (
    <Link className="ops-nav-link" href={item.href} aria-current={active ? "page" : undefined} onClick={close}>
      <NavIcon name={item.icon} />
      {item.label}
    </Link>
  );
}

export function OperationalShell({
  role,
  permissions = [],
  children,
}: {
  role?: Role;
  permissions?: Permission[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  const groups = visibleMenuGroups(permissions);
  const visibleBuyerItems = groups.buyer;
  const visibleManagerItems = groups.manager;
  const visibleControlItems = groups.control;
  const isManagerBadge = role === "GESTOR" || visibleManagerItems.length > 0;
  const badge = isManagerBadge ? "Gestor" : visibleBuyerItems.length > 0 ? "Comprador" : visibleControlItems.length > 0 ? "Controle" : "Comprador";

  return (
    <div className="ops-shell">
      <header className="ops-mobile-header">
        <button type="button" className="ops-menu-button" aria-label="Abrir menu" aria-expanded={open} onClick={() => setOpen(true)}>☰</button>
        <Image src="/brand/MS-H.png" alt="MultiShow FLV" width={2000} height={503} priority />
        <span>{badge}</span>
      </header>
      {open ? <button type="button" className="ops-backdrop" aria-label="Fechar menu" onClick={close} /> : null}
      <aside className={`ops-sidebar${open ? " ops-sidebar--open" : ""}`} aria-label="Navegação principal">
        <div className="ops-brand">
          <Image src="/brand/MS-H.png" alt="MultiShow FLV" width={2000} height={503} priority />
          <button type="button" className="ops-close" aria-label="Fechar menu" onClick={close}>×</button>
        </div>
        <nav className="ops-nav">
          <NavLink item={{ href: "/", label: "Início", icon: "home" }} close={close} />
          {visibleBuyerItems.length > 0 ? (
            <details className="ops-nav-section" open>
              <summary>COMPRADOR</summary>
              {visibleBuyerItems.map((item) => <NavLink item={item} close={close} key={item.href} />)}
            </details>
          ) : null}
          {visibleManagerItems.length > 0 ? (
            <details className="ops-nav-section" open>
              <summary>GESTOR</summary>
              {visibleManagerItems.map((item) => <NavLink item={item} close={close} key={item.href} />)}
            </details>
          ) : null}
          {visibleControlItems.length > 0 ? (
            <details className="ops-nav-section" open>
              <summary>CONTROLE</summary>
              {visibleControlItems.map((item) => <NavLink item={item} close={close} key={item.href} />)}
            </details>
          ) : null}
        </nav>
        <div className="ops-sidebar-footer">
          <NavLink item={{ href: "/minha-senha", label: "Minha senha", icon: "key" }} close={close} />
          <form action={logoutAction} className="ops-logout">
            <button type="submit"><NavIcon name="logout" /> Sair</button>
          </form>
        </div>
      </aside>
      <div className="ops-content">{children}</div>
    </div>
  );
}
