import { notFound, redirect } from "next/navigation";
import { requirePrincipal } from "@/modules/identity/session";
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
      <ConsolidatedWorkspace data={data} />
    </div>
  );
}
