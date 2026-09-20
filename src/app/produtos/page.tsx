import Link from "next/link";
import { redirect } from "next/navigation";
import { database } from "@/db/client";
import { products } from "@/db/schema";
import { requirePrincipal } from "@/modules/identity/session";
import { toggleProductAction } from "@/modules/catalog/actions";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const principal = await requirePrincipal();
  if (principal.role !== "GESTOR") redirect("/");
  const data = await database().db.select().from(products).orderBy(products.name);
  return <main className="page stack"><div className="row"><Link href="/">← Início</Link><h1>Produtos</h1></div><section className="product-grid">{data.map((product) => <article className="product-card" key={product.id}><h2>{product.name}</h2><p>{product.erpCode} · {product.unit} · compra {product.purchaseFormat}</p><p>Markup: {product.markup}% · {product.exclusiveSupplier ? "Fornecedor exclusivo" : "Demais fornecedores"}</p><form action={toggleProductAction}><input type="hidden" name="productId" value={product.id} /><input type="hidden" name="active" value={String(!product.active)} /><button className={product.active ? "btn btn--secondary" : "btn"}>{product.active ? "Inativar" : "Ativar"}</button></form></article>)}</section></main>;
}
