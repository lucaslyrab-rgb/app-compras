import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePrincipal } from "@/modules/identity/session";
import { listStoreHistory } from "@/modules/ordering/repository";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const principal = await requirePrincipal();
  if (principal.role !== "LOJA" || !principal.storeId) redirect("/");
  const orders = await listStoreHistory(principal, principal.storeId);
  return <main className="page stack"><div className="row"><Link href="/">← Pedido atual</Link><h1>Histórico de pedidos</h1></div>{orders.length === 0 ? <section className="panel"><p>Nenhum pedido enviado.</p></section> : orders.map((order) => <article className="panel" key={order.id}><h2>{new Intl.DateTimeFormat("pt-BR").format(new Date(`${order.orderDate}T12:00:00`))}</h2><p>Revisão {order.revision} · enviado em {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(order.submittedAt)}</p><Link href={`/pedidos/${order.id}/conferencia`}>Abrir conferência</Link></article>)}</main>;
}
