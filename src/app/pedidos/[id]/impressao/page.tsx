import { notFound, redirect } from "next/navigation";
import { hasPermission } from "@/modules/identity";
import { requirePrincipal } from "@/modules/identity/session";
import { OrderReportView } from "@/modules/ordering/order-report-view";
import { getHistoricalOrder, getStoreName } from "@/modules/ordering/repository";

export const dynamic = "force-dynamic";

export default async function OrderPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const principal = await requirePrincipal();
  if (!hasPermission(principal, "pedidos:historico") || !principal.storeId) {
    redirect("/");
  }

  const { id } = await params;
  let result;
  try {
    result = await getHistoricalOrder(principal, principal.storeId, id, false);
  } catch {
    notFound();
  }

  const storeName = await getStoreName(principal.storeId);
  const { order, items } = result;

  return (
    <OrderReportView
      order={order}
      storeName={storeName}
      items={items}
      variant="pedido"
    />
  );
}
