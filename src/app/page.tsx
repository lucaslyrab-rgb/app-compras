import { logoutAction } from "./login/actions";
import { requirePrincipal } from "@/modules/identity/session";
import { listActiveProducts } from "@/modules/catalog/repository";
import { OrderWorkspace } from "@/modules/ordering/order-workspace";
import { loadDraft } from "@/modules/ordering/repository";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const principal = await requirePrincipal();
  if (principal.role !== "LOJA" || !principal.storeId) {
    return (
      <div className="shell">
        <header className="topbar"><div className="topbar__inner"><div className="brand"><span className="brand__icon">🛒</span><div><h1>MultiShow FLV</h1><p>{principal.role}</p></div></div><form action={logoutAction}><button className="btn btn--secondary">Sair</button></form></div></header>
        <main className="page"><section className="panel"><h2>Fundação pronta</h2><p>Os módulos operacionais do Comprador e Gestor entram nos próximos PRDs.</p>{principal.role === "GESTOR" ? <Link className="btn" href="/produtos">Administrar produtos</Link> : null}</section></main>
      </div>
    );
  }
  const data = await listActiveProducts();
  const products = data.map((product) => ({ id: product.id, name: product.name, unit: product.unit }));
  const date = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const draft = await loadDraft(principal, principal.storeId, date);
  return <OrderWorkspace products={products} storeId={principal.storeId} initialDraft={draft} date={date} />;
}
