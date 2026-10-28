import { redirect } from "next/navigation";
import { requirePrincipal } from "@/modules/identity/session";
import { hasPermission } from "@/modules/identity/domain";
import { listActiveStores } from "@/modules/identity/repository";
import { queryLossesForManagement } from "@/modules/purchasing/losses/repository";
import { calculateLossDashboardKpis } from "@/modules/purchasing/losses/domain";
import { LossDashboardWorkspace, DEFAULT_LOSS_PAGE_SIZE } from "@/modules/purchasing/losses/loss-dashboard-workspace";

export const dynamic = "force-dynamic";

export default async function GestorLossesPage({
  searchParams,
}: {
  searchParams: Promise<{ storeId?: string; startDate?: string; endDate?: string; search?: string; limit?: string }>;
}) {
  const principal = await requirePrincipal();

  if (!hasPermission(principal, "perdas:consultar")) {
    redirect("/sem-acesso");
  }

  const params = await searchParams;
  const stores = await listActiveStores();

  const filters = {
    storeId: params.storeId || undefined,
    startDate: params.startDate || undefined,
    endDate: params.endDate || undefined,
    search: params.search || undefined,
  };

  // Consulta o período completo (sem limite de exibição) para que os filtros sejam
  // sempre resolvidos no servidor e os totais/KPIs reflitam todo o período filtrado,
  // não apenas a página atualmente exibida na tabela.
  const allMatching = await queryLossesForManagement(filters);
  const kpis = calculateLossDashboardKpis(allMatching);
  const pageSize = Number(params.limit) > 0 ? Number(params.limit) : DEFAULT_LOSS_PAGE_SIZE;
  const losses = allMatching.slice(0, pageSize);

  return (
    <LossDashboardWorkspace
      basePath="/gestor/perdas"
      stores={stores.map((s) => ({ id: s.id, name: s.name }))}
      losses={losses}
      kpis={kpis}
      totalMatching={allMatching.length}
      pageSize={pageSize}
      filters={filters}
    />
  );
}
