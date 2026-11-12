import { redirect } from "next/navigation";
import { hasPermission } from "@/modules/identity/domain";
import { listActiveStores } from "@/modules/identity/repository";
import { requirePrincipal } from "@/modules/identity/session";
import { ClosingWorkspace } from "@/modules/purchasing/reconciliation/closing-workspace";
import { getClosingOverview, type ClosingSearchParams } from "@/modules/purchasing/reconciliation/closing-service";

export const dynamic = "force-dynamic";

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // A autorização é verificada no servidor também aqui, além do layout.
  const principal = await requirePrincipal();
  if (!hasPermission(principal, "fechamento:consultar")) {
    redirect("/sem-acesso");
  }

  const raw = await searchParams;
  const params = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[value.length - 1] : value]),
  ) as ClosingSearchParams;

  const [stores, overview] = await Promise.all([listActiveStores(), getClosingOverview(params)]);
  return <ClosingWorkspace overview={overview} stores={stores.map((s) => ({ id: s.id, name: s.name }))} />;
}
