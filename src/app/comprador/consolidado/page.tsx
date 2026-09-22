import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { requirePrincipal } from "@/modules/identity/session";
import { logoutAction } from "@/app/login/actions";
import { canViewConsolidated, isCycleDate } from "@/modules/purchasing/domain";
import { loadConsolidated } from "@/modules/purchasing/service";
import { ConsolidatedWorkspace } from "@/modules/purchasing/consolidated-workspace";
import "./styles.css";

export const dynamic = "force-dynamic";

export default async function ConsolidatedPage({
  searchParams,
}: {
  searchParams: Promise<{ ciclo?: string }>;
}) {
  const principal = await requirePrincipal();
  if (!canViewConsolidated(principal)) redirect("/");
  const { ciclo } = await searchParams;
  if (ciclo && !isCycleDate(ciclo)) notFound();
  const data = await loadConsolidated(principal, ciclo);
  return (
    <div className="buyer-shell">
      <header className="topbar">
        <div className="topbar__inner">
          <div className="brand">
            <Image
              className="brand__logo"
              src="/brand/MS-H.png"
              alt="MultiShow FLV"
              width={170}
              height={43}
              priority
            />
            <div>
              <h1>MultiShow FLV</h1>
              <p>{principal.role === "GESTOR" ? "Gestor" : "Comprador"}</p>
            </div>
          </div>
          <form action={logoutAction}>
            <button className="btn btn--secondary">Sair</button>
          </form>
        </div>
      </header>
      <nav className="buyer-nav" aria-label="Navegação do Comprador">
        <Link className="btn" href="/comprador/consolidado" aria-current="page">
          Consolidado
        </Link>
        {principal.role === "GESTOR" ? (
          <Link className="btn btn--secondary" href="/produtos">
            Administrar produtos
          </Link>
        ) : null}
      </nav>
      <ConsolidatedWorkspace data={data} />
    </div>
  );
}
