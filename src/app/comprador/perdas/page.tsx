import { redirect } from "next/navigation";
import { requirePrincipal } from "@/modules/identity/session";
import { hasPermission } from "@/modules/identity/domain";
import { listActiveStores } from "@/modules/identity/repository";
import { queryLossesForManagement } from "@/modules/purchasing/losses/repository";
import { LossDashboardWorkspace } from "@/modules/purchasing/losses/loss-dashboard-workspace";

export const dynamic = "force-dynamic";

export default async function CompradorLossesPage({
  searchParams,
}: {
  searchParams: Promise<{ storeId?: string; startDate?: string; endDate?: string; search?: string }>;
}) {
  const principal = await requirePrincipal();

  if (!hasPermission(principal, "perdas:consultar")) {
    redirect("/sem-acesso");
  }

  const params = await searchParams;
  const stores = await listActiveStores();

  const losses = await queryLossesForManagement({
    storeId: params.storeId || undefined,
    startDate: params.startDate || undefined,
    endDate: params.endDate || undefined,
    search: params.search || undefined,
  });

  return (
    <LossDashboardWorkspace
      stores={stores.map((s) => ({ id: s.id, name: s.name }))}
      initialLosses={losses}
      initialFilters={params}
    />
  );
}
