import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePrincipal } from "@/modules/identity/session";
import { listActiveProducts } from "@/modules/catalog/repository";
import { getStoreName } from "@/modules/ordering/repository";

export const dynamic = "force-dynamic";

export default async function CountPage() {
  const principal = await requirePrincipal();
  if (principal.role !== "LOJA" || !principal.storeId) redirect("/");
  const products = await listActiveProducts();
  const storeName = await getStoreName(principal.storeId);
  const rows = Array.from({ length: Math.ceil(products.length / 2) }, (_, index) => [products[index * 2], products[index * 2 + 1]] as const);
  return <main className="count-report"><div className="count-report__actions no-print"><Link className="btn btn--secondary" href="/">← Voltar ao pedido</Link><span className="muted">Use Ctrl/Cmd+P para imprimir</span></div><header className="count-report__header"><h1>MULTISHOW FLV — CONTAGEM PARA PEDIDO</h1><p>Loja: {storeName}</p><p>Data: {new Intl.DateTimeFormat("pt-BR").format(new Date())}</p><p>Responsável: ______________________________</p></header><table className="count-table"><thead><tr><th>Cód.</th><th>Produto</th><th>Estoque</th><th>Pedido</th><th>Cód.</th><th>Produto</th><th>Estoque</th><th>Pedido</th></tr></thead><tbody>{rows.map(([left, right], index) => <tr key={index}>{left ? <><td>{left.erpCode}</td><td>{left.name} ({left.unit})</td><td /><td /></> : <><td /><td /><td /><td /></>}{right ? <><td>{right.erpCode}</td><td>{right.name} ({right.unit})</td><td /><td /></> : <><td /><td /><td /><td /></>}</tr>)}</tbody></table></main>;
}
