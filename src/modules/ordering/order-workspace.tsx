"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { logoutAction } from "@/app/login/actions";
import { saveDraftAction, submitOrderAction } from "./actions";
import Link from "next/link";

type Product = { id: string; erpCode: number; name: string; unit: string };
type Filter = "all" | "empty" | "filled";

export function OrderWorkspace({ products, storeId, storeName, initialDraft, date }: { products: Product[]; storeId: string; storeName: string; initialDraft: { version: number; items: Array<{ productId: string; stock: number; quantity: number }> }; date: string }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [values, setValues] = useState<Record<string, { stock: string; quantity: string }>>(() => Object.fromEntries(initialDraft.items.map((item) => [item.productId, { stock: String(item.stock), quantity: String(item.quantity) }])));
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [state, saveAction, pending] = useActionState(saveDraftAction, {});
  const [submitState, submitAction, submitting] = useActionState(submitOrderAction, {});
  const visibleProducts = useMemo(() => products.filter((product) => {
    const value = values[product.id];
    const filled = Number(value?.quantity ?? 0) > 0;
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    return (!normalizedQuery || product.name.toLocaleLowerCase("pt-BR").includes(normalizedQuery) || String(product.erpCode).includes(normalizedQuery)) && (filter === "all" || (filter === "filled" ? filled : !filled));
  }), [filter, products, query, values]);
  const visibleIds = useMemo(() => new Set(visibleProducts.map((product) => product.id)), [visibleProducts]);
  const inputOrder = useMemo(() => visibleProducts.flatMap((product) => [`${product.id}:stock`, `${product.id}:quantity`]), [visibleProducts]);
  function handleEnter(inputKey: string) {
    return (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const nextKey = inputOrder[inputOrder.indexOf(inputKey) + 1];
      if (nextKey) requestAnimationFrame(() => inputRefs.current[nextKey]?.focus());
      else event.currentTarget.blur();
    };
  }
  const feedback = submitState.message ? submitState : state;
  const currentVersion = submitState.version ?? state.version ?? initialDraft.version;

  return (
    <div className="shell">
      <header className="topbar no-print"><div className="topbar__inner"><div className="brand"><span className="brand__icon">🏪</span><div><h1>MultiShow FLV</h1><p>{storeName} · Pedido da loja</p></div></div><form action={logoutAction}><button className="btn btn--secondary">Sair</button></form></div></header>
      <form action={saveAction}>
        <input type="hidden" name="storeId" value={storeId} />
        <input type="hidden" name="orderDate" value={date} />
        <input type="hidden" name="version" value={currentVersion} />
        <main className="page stack">
          <section className="panel stack no-print">
            <div className="row"><div><h2>Pedido de hoje</h2><p className="muted">{new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date(`${date}T12:00:00`))}</p></div><div className="row"><Link href="/contagem" className="btn btn--secondary">Imprimir Contagem de Estoque</Link><Link href="/historico">Ver histórico</Link></div></div>
            {feedback.message ? <p className={feedback.status === "error" ? "error" : "success"} role="status">{feedback.message}</p> : null}
            <label className="field"><span className="visually-hidden">Buscar produto</span><input className="search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar produto…" /></label>
            <div className="filters" aria-label="Filtrar produtos">
              {(["all", "empty", "filled"] as const).map((value) => <button key={value} className="filter" type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === "all" ? "Todos" : value === "empty" ? "Sem pedido" : "Com pedido"}</button>)}
            </div>
          </section>
          <section className="product-list" aria-live="polite">
            <div className="product-list__header" aria-hidden="true"><span>Produto</span><span>Estoque atual</span><span>Pedido</span></div>
            {products.map((product) => {
              const value = values[product.id] ?? { stock: "", quantity: "" };
              return <article className="product-card" data-filled={Number(value.quantity) > 0} key={product.id} hidden={!visibleIds.has(product.id)}>
                <div className="product-name"><h2>{product.name}</h2><span className="product-unit">{product.unit}</span></div>
                <input type="hidden" name="productId" value={product.id} />
                <div className="product-fields">
                  <label className="field"><span>Estoque atual ({product.unit})</span><input ref={(element) => { inputRefs.current[`${product.id}:stock`] = element; }} name="stock" inputMode="decimal" type="text" value={value.stock} onFocus={(event) => event.currentTarget.select()} onKeyDown={handleEnter(`${product.id}:stock`)} onChange={(event) => setValues((current) => ({ ...current, [product.id]: { ...value, stock: event.target.value } }))} /></label>
                  <label className="field"><span>Pedido ({product.unit})</span><input ref={(element) => { inputRefs.current[`${product.id}:quantity`] = element; }} name="quantity" inputMode="decimal" type="text" value={value.quantity} onFocus={(event) => event.currentTarget.select()} onKeyDown={handleEnter(`${product.id}:quantity`)} onChange={(event) => setValues((current) => ({ ...current, [product.id]: { ...value, quantity: event.target.value } }))} /></label>
                </div>
              </article>;
            })}
          </section>
        </main>
        <footer className="sticky-actions no-print"><div className="sticky-actions__inner"><button className="btn btn--secondary" type="button" onClick={() => setValues({})}>Limpar</button><button className="btn" type="submit" disabled={pending || submitting}>{pending ? "Salvando…" : "Salvar rascunho"}</button><button className="btn" formAction={submitAction} disabled={pending || submitting}>{submitting ? "Enviando…" : "Enviar pedido"}</button></div></footer>
      </form>
    </div>
  );
}
