import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePrincipal } from "@/modules/identity/session";
import { getStoreName, listStoreHistory } from "@/modules/ordering/repository";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const principal = await requirePrincipal();
  if (principal.role !== "LOJA" || !principal.storeId) redirect("/");
  const orders = await listStoreHistory(principal, principal.storeId);
  const latestByCycle = new Map<string, string>();
  for (const order of orders) if (!latestByCycle.has(order.purchaseCycleDate)) latestByCycle.set(order.purchaseCycleDate, order.cancelledAt ? "" : order.id);
  const storeName = await getStoreName(principal.storeId);
  return <main className="page stack"><div className="row"><Link className="btn btn--secondary" href="/">← Voltar ao pedido</Link><h1>Histórico de pedidos</h1></div><p className="muted">{storeName}</p>{orders.length === 0 ? <section className="panel"><p>Nenhum pedido enviado.</p></section> : <section className="history-list">{orders.map((order) => <article className="panel history-card" key={order.id}><div><h2>{new Intl.DateTimeFormat("pt-BR").format(new Date(`${order.orderDate}T12:00:00`))} · {new Intl.DateTimeFormat("pt-BR", { timeStyle: "short" }).format(order.submittedAt)}</h2><p>Compra: {new Intl.DateTimeFormat("pt-BR").format(new Date(`${order.purchaseCycleDate}T12:00:00`))} · revisão {order.revision} · {order.itemCount} produtos pedidos</p>{order.cancelledAt ? <strong className="cancelled">CANCELADO</strong> : latestByCycle.get(order.purchaseCycleDate) === order.id ? <strong className="success-badge">REVISÃO OPERACIONAL VIGENTE</strong> : null}</div><Link className="btn btn--secondary" href={`/pedidos/${order.id}/detalhes`}>Ver pedido</Link></article>)}</section>}</main>;
}
