import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePrincipal } from "@/modules/identity/session";
import { getStoreName, listStoreHistory } from "@/modules/ordering/repository";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const principal = await requirePrincipal();
  if (principal.role !== "LOJA" || !principal.storeId) redirect("/");
  const orders = await listStoreHistory(principal, principal.storeId);
  const storeName = await getStoreName(principal.storeId);
  return <main className="page stack"><div className="row"><Link href="/">← Pedido atual</Link><h1>Histórico de pedidos</h1></div><p className="muted">{storeName}</p>{orders.length === 0 ? <section className="panel"><p>Nenhum pedido enviado.</p></section> : <section className="history-list">{orders.map((order) => <article className="panel history-card" key={order.id}><div><h2>{new Intl.DateTimeFormat("pt-BR").format(new Date(`${order.orderDate}T12:00:00`))}</h2><p>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(order.submittedAt)} · {order.itemCount} produtos pedidos · revisão {order.revision}</p>{order.cancelledAt ? <strong className="cancelled">CANCELADO</strong> : null}</div><Link className="btn btn--secondary" href={`/pedidos/${order.id}/detalhes`}>Ver pedido</Link></article>)}</section>}</main>;
}
