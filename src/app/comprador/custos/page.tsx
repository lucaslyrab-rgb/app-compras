import { notFound, redirect } from "next/navigation";
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
      <PurchaseCostsWorkspace key={data.cycleDate} data={data} />
    </div>
  );
}
