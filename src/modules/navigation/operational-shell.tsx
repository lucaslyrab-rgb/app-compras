"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { logoutAction } from "@/app/login/actions";
import type { Permission, Role } from "@/modules/identity";

type NavItem = { href: string; label: string; icon: string; permission?: Permission };

const buyerItems: (NavItem & { permission: Permission })[] = [
  { href: "/comprador/consolidado", label: "Consolidado", icon: "▤", permission: "compras:consolidado" },
  { href: "/comprador/custos", label: "Lançamento de Custos", icon: "▣", permission: "compras:custos" },
];
const managerItems: (NavItem & { permission: Permission })[] = [
  { href: "/gestor/produtos", label: "Produtos", icon: "•", permission: "gestor:produtos" },
  { href: "/gestor/precificacao", label: "Precificação", icon: "•", permission: "gestor:precificacao" },
  { href: "/gestor/configuracoes", label: "Configurações", icon: "⚙", permission: "gestor:configuracoes" },
  { href: "/gestor/usuarios", label: "Usuários", icon: "👤", permission: "gestor:usuarios" },
];

function NavLink({ item, close }: { item: NavItem; close: () => void }) {
  const pathname = usePathname();
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  return (
    <Link className="ops-nav-link" href={item.href} aria-current={active ? "page" : undefined} onClick={close}>
      <span aria-hidden="true">{item.icon}</span>
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

  const visibleBuyerItems = buyerItems.filter((item) => permissions.includes(item.permission));
  const visibleManagerItems = managerItems.filter((item) => permissions.includes(item.permission));
  const isManagerBadge = role === "GESTOR" || visibleManagerItems.length > 0;

  return (
    <div className="ops-shell">
      <header className="ops-mobile-header">
        <button type="button" className="ops-menu-button" aria-label="Abrir menu" aria-expanded={open} onClick={() => setOpen(true)}>☰</button>
        <Image src="/brand/MS-H.png" alt="MultiShow FLV" width={2000} height={503} priority />
        <span>{isManagerBadge ? "Gestor" : "Comprador"}</span>
      </header>
      {open ? <button type="button" className="ops-backdrop" aria-label="Fechar menu" onClick={close} /> : null}
      <aside className={`ops-sidebar${open ? " ops-sidebar--open" : ""}`} aria-label="Navegação principal">
        <div className="ops-brand">
          <Image src="/brand/MS-H.png" alt="MultiShow FLV" width={2000} height={503} priority />
          <button type="button" className="ops-close" aria-label="Fechar menu" onClick={close}>×</button>
        </div>
        <nav className="ops-nav">
          <NavLink item={{ href: "/", label: "Início", icon: "⌂" }} close={close} />
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
        </nav>
        <div className="ops-sidebar-footer">
          <NavLink item={{ href: "/minha-senha", label: "Minha senha", icon: "🔑" }} close={close} />
          <form action={logoutAction} className="ops-logout">
            <button type="submit"><span aria-hidden="true">↪</span> Sair</button>
          </form>
        </div>
      </aside>
      <div className="ops-content">{children}</div>
    </div>
  );
}
