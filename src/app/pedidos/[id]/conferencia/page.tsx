import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePrincipal } from "@/modules/identity/session";
import { getConferenceOrder } from "@/modules/ordering/repository";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

export default async function ConferencePage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePrincipal();
  if (principal.role !== "LOJA" || !principal.storeId) redirect("/");
  let result;
  try { result = await getConferenceOrder(principal, principal.storeId, (await params).id); } catch { notFound(); }
  const hasItems = result.items.length > 0;
  return <main className="page stack"><div className="row no-print"><Link href="/historico">← Histórico</Link>{hasItems ? <PrintButton /> : null}</div><section className="panel"><h1>Conferência de recebimento</h1><p><strong>Data do pedido:</strong> {new Intl.DateTimeFormat("pt-BR").format(new Date(`${result.order.orderDate}T12:00:00`))} · <strong>Revisão:</strong> {result.order.revision}</p>{!hasItems ? <p className="error" role="alert">Não há itens pedidos para conferir nesta revisão.</p> : <><p><strong>Data do recebimento:</strong> ____________________</p><p><strong>Responsável:</strong> ____________________</p><table className="report-table"><thead><tr><th>Código</th><th>Produto</th><th>Unidade</th><th>Pedido</th><th>Recebido</th></tr></thead><tbody>{result.items.map((item) => <tr key={item.erpCode}><td>{item.erpCode}</td><td>{item.name}</td><td>{item.unit}</td><td>{item.quantity}</td><td>________</td></tr>)}</tbody></table></>}</section></main>;
}
