import { notFound, redirect } from "next/navigation";
import { requirePrincipal } from "@/modules/identity/session";
import {
  canManageDestinations,
  isCycleDate,
} from "@/modules/purchasing/allocations/domain";
import { readBuyerAllocationWorkspace } from "@/modules/purchasing/allocations/repository";
import { BuyerAllocationWorkspace } from "@/modules/purchasing/allocations/buyer-allocation-workspace";

export const dynamic = "force-dynamic";

export default async function BuyerDestinacaoPage({
  searchParams,
}: {
  searchParams: Promise<{ ciclo?: string; fornecedor?: string }>;
}) {
  const principal = await requirePrincipal();
  if (!canManageDestinations(principal)) redirect("/");

  const { ciclo, fornecedor } = await searchParams;
  if (ciclo && !isCycleDate(ciclo)) notFound();

  const data = await readBuyerAllocationWorkspace(principal, ciclo, fornecedor);

  return (
    <BuyerAllocationWorkspace
      data={data}
      key={`${data.cycleDate}:${data.selectedSupplierId ?? "none"}`}
    />
  );
}
