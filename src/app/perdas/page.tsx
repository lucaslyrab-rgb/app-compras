import { redirect } from "next/navigation";
import { requirePrincipal } from "@/modules/identity/session";
import { hasPermission } from "@/modules/identity/domain";
import { listActiveProducts } from "@/modules/catalog/repository";
import { toIsoDateString } from "@/modules/catalog/domain";
import { getStoreName } from "@/modules/ordering/repository";
import { listTodayLossesForStore } from "@/modules/purchasing/losses/repository";
import { StoreLossWorkspace } from "@/modules/purchasing/losses/store-loss-workspace";

export const dynamic = "force-dynamic";

export default async function StoreLossPage() {
  const principal = await requirePrincipal();

  if (!hasPermission(principal, "loja:perdas") || !principal.storeId) {
    redirect("/sem-acesso");
  }

  const storeName = await getStoreName(principal.storeId);
  const catalog = await listActiveProducts();
  const products = catalog.map((p) => ({
    id: p.id,
    erpCode: p.erpCode,
    name: p.name,
    unit: p.unit,
    purchaseFormat: p.purchaseFormat,
    photoKey: p.photoKey,
    photoUpdatedAt: toIsoDateString(p.photoUpdatedAt),
  }));

  const initialLosses = await listTodayLossesForStore(principal.storeId);

  return (
    <StoreLossWorkspace
      storeId={principal.storeId}
      storeName={storeName}
      products={products}
      initialLosses={initialLosses}
    />
  );
}
