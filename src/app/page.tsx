import { requirePrincipal } from "@/modules/identity/session";
import { listActiveProducts } from "@/modules/catalog/repository";
import { currentPurchaseCycle } from "@/modules/ordering/calendar/service";
import { OrderWorkspace } from "@/modules/ordering/order-workspace";
import { getStoreName, loadDraft } from "@/modules/ordering/repository";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const principal = await requirePrincipal();
  if (principal.role === "COMPRADOR") redirect("/comprador/consolidado");
  if (principal.role === "GESTOR") redirect("/gestor/produtos");
  if (principal.role !== "LOJA" || !principal.storeId) {
    redirect("/login");
  }
  const data = await listActiveProducts();
  const products = data.map((product) => ({ id: product.id, erpCode: product.erpCode, name: product.name, unit: product.unit }));
  const cycle = await currentPurchaseCycle();
  const date = cycle.localDate;
  const draft = await loadDraft(principal, principal.storeId, date);
  const storeName = await getStoreName(principal.storeId);
  return <OrderWorkspace products={products} storeId={principal.storeId} storeName={storeName} initialDraft={draft} date={date} cycleDate={cycle.cycleDate} cutoffAt={cycle.cutoffAt.toISOString()} />;
}
