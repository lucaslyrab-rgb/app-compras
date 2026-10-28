import { requirePrincipal } from "@/modules/identity/session";
import { hasPermission, resolveOperationalRoute } from "@/modules/identity";
import { listActiveProducts } from "@/modules/catalog/repository";
import { toIsoDateString } from "@/modules/catalog/domain";
import { currentPurchaseCycle } from "@/modules/ordering/calendar/service";
import { OrderWorkspace } from "@/modules/ordering/order-workspace";
import { getStoreName, loadDraft } from "@/modules/ordering/repository";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const principal = await requirePrincipal();

  if (hasPermission(principal, "pedidos:criar") && principal.storeId) {
    const data = await listActiveProducts();
    const products = data.map((product) => ({
      id: product.id,
      erpCode: product.erpCode,
      name: product.name,
      unit: product.unit,
      purchaseFormat: product.purchaseFormat,
      photoKey: product.photoKey,
      photoUpdatedAt: toIsoDateString(product.photoUpdatedAt),
    }));
    const cycle = await currentPurchaseCycle();
    const date = cycle.localDate;
    const draft = await loadDraft(principal, principal.storeId, date);
    const storeName = await getStoreName(principal.storeId);
    return (
      <OrderWorkspace
        products={products}
        storeId={principal.storeId}
        storeName={storeName}
        initialDraft={draft}
        date={date}
        cycleDate={cycle.cycleDate}
        cutoffAt={cycle.cutoffAt.toISOString()}
        hasConferencePermission={hasPermission(principal, "loja:conferencia")}
        hasLossPermission={hasPermission(principal, "loja:perdas")}
      />
    );
  }

  const destination = resolveOperationalRoute(principal);
  if (destination && destination !== "/") {
    redirect(destination);
  }

  redirect("/sem-acesso");
}
