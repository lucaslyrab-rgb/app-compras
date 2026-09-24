"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { logoutAction } from "@/app/login/actions";
import type { Role } from "@/modules/identity";

type NavItem = { href: string; label: string; icon: string };

const buyerItems: NavItem[] = [
  { href: "/comprador/consolidado", label: "Consolidado", icon: "▤" },
  { href: "/comprador/custos", label: "Lançamento de Custos", icon: "▣" },
];
const managerItems: NavItem[] = [
  { href: "/gestor/produtos", label: "Produtos", icon: "•" },
  { href: "/gestor/precificacao", label: "Precificação", icon: "•" },
  { href: "/gestor/configuracoes", label: "Configurações", icon: "⚙" },
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

export function OperationalShell({ role, children }: { role: Role; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <div className="ops-shell">
      <header className="ops-mobile-header">
        <button type="button" className="ops-menu-button" aria-label="Abrir menu" aria-expanded={open} onClick={() => setOpen(true)}>☰</button>
        <Image src="/brand/MS-H.png" alt="MultiShow FLV" width={2000} height={503} priority />
        <span>{role === "GESTOR" ? "Gestor" : "Comprador"}</span>
      </header>
      {open ? <button type="button" className="ops-backdrop" aria-label="Fechar menu" onClick={close} /> : null}
      <aside className={`ops-sidebar${open ? " ops-sidebar--open" : ""}`} aria-label="Navegação principal">
        <div className="ops-brand">
          <Image src="/brand/MS-H.png" alt="MultiShow FLV" width={2000} height={503} priority />
          <button type="button" className="ops-close" aria-label="Fechar menu" onClick={close}>×</button>
        </div>
        <nav className="ops-nav">
          <NavLink item={{ href: "/", label: "Início", icon: "⌂" }} close={close} />
          <details className="ops-nav-section" open>
            <summary>COMPRADOR</summary>
            {buyerItems.map((item) => <NavLink item={item} close={close} key={item.href} />)}
          </details>
          {role === "GESTOR" ? (
            <details className="ops-nav-section" open>
              <summary>GESTOR</summary>
              {managerItems.map((item) => <NavLink item={item} close={close} key={item.href} />)}
            </details>
          ) : null}
        </nav>
        <form action={logoutAction} className="ops-logout">
          <button type="submit"><span aria-hidden="true">↪</span> Sair</button>
        </form>
      </aside>
      <div className="ops-content">{children}</div>
    </div>
  );
}
