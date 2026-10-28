import { redirect } from "next/navigation";
import { requirePrincipal } from "@/modules/identity/session";
import { hasPermission } from "@/modules/identity/domain";
import { listActiveStores } from "@/modules/identity/repository";
import { queryLossesForManagement, countLossesForManagement, aggregateLossesForManagement } from "@/modules/purchasing/losses/repository";
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

  const pageSize = Number(params.limit) > 0 ? Number(params.limit) : DEFAULT_LOSS_PAGE_SIZE;

  // KPIs e total são calculados no banco sobre TODO o período filtrado, nunca sobre
  // a página exibida; a lista da tabela é paginada separadamente (LIMIT/OFFSET).
  const [kpis, totalMatching, losses] = await Promise.all([
    aggregateLossesForManagement(filters),
    countLossesForManagement(filters),
    queryLossesForManagement(filters, { limit: pageSize }),
  ]);

  return (
    <LossDashboardWorkspace
      basePath="/gestor/perdas"
      stores={stores.map((s) => ({ id: s.id, name: s.name }))}
      losses={losses}
      kpis={kpis}
      totalMatching={totalMatching}
      pageSize={pageSize}
      filters={filters}
    />
  );
}
