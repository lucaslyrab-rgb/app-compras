import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { logoutAction } from "@/app/login/actions";
import { requirePrincipal } from "@/modules/identity/session";
import { canManagePurchaseCosts } from "@/modules/purchasing/costs/domain";
import { loadPurchaseCosts } from "@/modules/purchasing/costs/service";
import { PurchaseCostsWorkspace } from "@/modules/purchasing/cost-workspace";
import { isCycleDate } from "@/modules/purchasing/domain";
import "./styles.css";

export const dynamic = "force-dynamic";

export default async function PurchaseCostsPage({
  searchParams,
}: {
  searchParams: Promise<{ ciclo?: string }>;
}) {
  const principal = await requirePrincipal();
  if (!canManagePurchaseCosts(principal)) redirect("/");
  const { ciclo } = await searchParams;
  if (ciclo && !isCycleDate(ciclo)) notFound();
  const data = await loadPurchaseCosts(principal, ciclo);

  return (
    <div className="cost-shell">
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
      <nav className="cost-nav" aria-label="Navegação do Comprador">
        <Link className="btn btn--secondary" href="/comprador/consolidado">
          Consolidado
        </Link>
        <Link className="btn" href="/comprador/custos" aria-current="page">
          Lançar custos
        </Link>
        {principal.role === "GESTOR" ? (
          <Link className="btn btn--secondary" href="/produtos">
            Administrar produtos
          </Link>
        ) : null}
      </nav>
      <PurchaseCostsWorkspace key={data.cycleDate} data={data} />
    </div>
  );
}
