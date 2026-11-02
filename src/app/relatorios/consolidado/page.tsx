import { notFound, redirect } from "next/navigation";
import { requirePrincipal } from "@/modules/identity/session";
import { canViewConsolidated, isCycleDate } from "@/modules/purchasing/domain";
import { loadConsolidated } from "@/modules/purchasing/service";
import { buildConsolidatedPrintModel } from "@/modules/purchasing/reports/consolidated-print/domain";
import { ConsolidatedPrintView } from "@/modules/purchasing/reports/consolidated-print/consolidated-print-view";

export const dynamic = "force-dynamic";

export default async function ConsolidatedPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ ciclo?: string }>;
}) {
  const principal = await requirePrincipal();
  if (!canViewConsolidated(principal)) redirect("/");
  const { ciclo } = await searchParams;
  if (ciclo && !isCycleDate(ciclo)) notFound();
  const data = await loadConsolidated(principal, ciclo);
  return <ConsolidatedPrintView model={buildConsolidatedPrintModel(data)} />;
}
