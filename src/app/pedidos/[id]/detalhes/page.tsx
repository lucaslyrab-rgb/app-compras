import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePrincipal } from "@/modules/identity/session";
import { getHistoricalOrder, getStoreName } from "@/modules/ordering/repository";
import { CancelForm } from "./cancel-form";

export const dynamic = "force-dynamic";

export default async function OrderDetailsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ all?: string }> }) {
  const principal = await requirePrincipal();
  if (principal.role !== "LOJA" || !principal.storeId) redirect("/");
  const { id } = await params;
  const { all } = await searchParams;
  let result;
  try { result = await getHistoricalOrder(principal, principal.storeId, id, all === "1"); } catch { notFound(); }
  const storeName = await getStoreName(principal.storeId);
  const { order, items } = result;
  return <main className="page stack"><div className="row"><Link className="btn btn--secondary" href="/historico">← Voltar ao histórico</Link><h1>Pedido — {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(order.submittedAt)}</h1></div><p>{storeName} · compra {new Intl.DateTimeFormat("pt-BR").format(new Date(`${order.purchaseCycleDate}T12:00:00`))} · revisão {order.revision}</p>{order.cancelledAt ? <p className="cancelled">CANCELADO em {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(order.cancelledAt)}{order.cancellationReason ? ` — ${order.cancellationReason}` : ""}</p> : null}<div className="row"><Link className="btn btn--secondary" href={`/pedidos/${id}/detalhes${all === "1" ? "" : "?all=1"}`}>{all === "1" ? "Mostrar somente pedidos" : "Mostrar todos os produtos"}</Link></div><section className="panel"><table className="report-table"><thead><tr><th>Produto</th><th>Estoque</th><th>Pedido</th></tr></thead><tbody>{items.map((item) => <tr key={item.erpCode}><td>{item.erpCode} · {item.name} ({item.unit})</td><td>{item.stock}</td><td>{item.quantity}</td></tr>)}</tbody></table>{items.length === 0 ? <p>Nenhum item com pedido informado.</p> : null}</section>{!order.cancelledAt ? <section className="panel"><h2>Cancelar pedido</h2><CancelForm orderId={id} storeName={storeName} /></section> : null}</main>;
}
