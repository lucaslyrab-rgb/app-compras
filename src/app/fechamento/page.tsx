import { redirect } from "next/navigation";
import { hasPermission } from "@/modules/identity/domain";
import { listActiveStores } from "@/modules/identity/repository";
import { requirePrincipal } from "@/modules/identity/session";
import { ReconciliationWorkspace } from "@/modules/purchasing/reconciliation/reconciliation-workspace";
import { getReconciliation, type ReconciliationSearchParams } from "@/modules/purchasing/reconciliation/service";

export const dynamic = "force-dynamic";

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<ReconciliationSearchParams>;
}) {
  // A autorização é verificada no servidor também aqui, além do layout.
  const principal = await requirePrincipal();
  if (!hasPermission(principal, "fechamento:consultar")) {
    redirect("/sem-acesso");
  }

  const raw = await searchParams;
  const params = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[value.length - 1] : value]),
  ) as ReconciliationSearchParams;

  const [stores, result] = await Promise.all([listActiveStores(), getReconciliation(params)]);
  const storeOptions = stores.map((s) => ({ id: s.id, name: s.name }));

  if (!result.ok) {
    return (
      <ReconciliationWorkspace
        stores={storeOptions}
        suppliers={[]}
        filters={result.filters}
        kpis={null}
        lines={[]}
        totalMatching={0}
        pageSize={0}
        error={result.error}
      />
    );
  }

  return (
    <ReconciliationWorkspace
      stores={storeOptions}
      suppliers={result.suppliers}
      filters={result.filters}
      kpis={result.kpis}
      lines={result.lines}
      totalMatching={result.totalMatching}
      pageSize={result.pageSize}
    />
  );
}
