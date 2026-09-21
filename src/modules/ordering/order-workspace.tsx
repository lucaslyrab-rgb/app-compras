"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { logoutAction } from "@/app/login/actions";
import { saveDraftAction, submitOrderAction, type State } from "./actions";
import Link from "next/link";
import Image from "next/image";

type Product = { id: string; erpCode: number; name: string; unit: string };
type Filter = "all" | "empty" | "filled";

export function OrderWorkspace({ products, storeId, storeName, initialDraft, date, cycleDate, cutoffAt }: { products: Product[]; storeId: string; storeName: string; initialDraft: { version: number; items: Array<{ productId: string; stock: number; quantity: number }> }; date: string; cycleDate: string; cutoffAt: string }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [values, setValues] = useState<Record<string, { stock: string; quantity: string }>>(() => Object.fromEntries(initialDraft.items.map((item) => [item.productId, { stock: String(item.stock), quantity: String(item.quantity) }])));
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const dialogRef = useRef<HTMLElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const [state, saveAction, pending] = useActionState(saveDraftAction, {});
  const [submitState, submitAction, submitting] = useActionState(submitOrderAction, {});
  const [revisionDialogOpen, setRevisionDialogOpen] = useState(false);
  const [revisionSubmitting, setRevisionSubmitting] = useState(false);
  const visibleProducts = useMemo(() => products.filter((product) => {
    const value = values[product.id];
    const filled = Number(value?.quantity ?? 0) > 0;
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    return (!normalizedQuery || product.name.toLocaleLowerCase("pt-BR").includes(normalizedQuery) || String(product.erpCode).includes(normalizedQuery)) && (filter === "all" || (filter === "filled" ? filled : !filled));
  }), [filter, products, query, values]);
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
  const feedback: State = submitState.message ? submitState : state;
  const currentVersion = submitState.version ?? state.version ?? initialDraft.version;

  const closeRevisionDialog = useCallback(() => {
    if (revisionSubmitting) return;
    setRevisionDialogOpen(false);
    requestAnimationFrame(() => lastFocusedRef.current?.focus());
  }, [revisionSubmitting]);

  useEffect(() => {
    let cancelled = false;
    if (submitState.status === "confirm") {
      lastFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      queueMicrotask(() => {
        if (!cancelled) {
          setRevisionSubmitting(false);
          setRevisionDialogOpen(true);
        }
      });
    } else if (submitState.status === "success" || submitState.status === "error") {
      queueMicrotask(() => {
        if (!cancelled) {
          setRevisionDialogOpen(false);
          setRevisionSubmitting(false);
        }
      });
    }
    return () => { cancelled = true; };
  }, [submitState.status]);

  useEffect(() => {
    if (!revisionDialogOpen) return;
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !revisionSubmitting) closeRevisionDialog();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeRevisionDialog, revisionDialogOpen, revisionSubmitting]);

  function confirmRevision() {
    if (revisionSubmitting || submitting) return;
    setRevisionSubmitting(true);
    setRevisionDialogOpen(false);
    const formData = new FormData();
    formData.set("storeId", storeId);
    formData.set("orderDate", date);
    formData.set("version", String(currentVersion));
    formData.set("allowRevision", "1");
    for (const product of products) {
      const value = values[product.id] ?? { stock: "", quantity: "" };
      formData.append("productId", product.id);
      formData.append("stock", value.stock);
      formData.append("quantity", value.quantity);
    }
    submitAction(formData);
  }

  return (
    <div className="shell">
      <header className="topbar no-print"><div className="topbar__inner"><div className="brand"><Image className="brand__logo" src="/brand/MS-H.png" alt="MultiShow FLV" width={170} height={43} priority /><div><h1>MultiShow FLV</h1><p>{storeName} · Pedido da loja</p></div></div><form action={logoutAction}><button className="btn btn--secondary">Sair</button></form></div></header>
      {submitState.status === "success" || submitState.status === "error" ? <div className={`floating-feedback floating-feedback--${submitState.status}`} role="status" aria-live="polite">{submitState.message}</div> : null}
      <form action={saveAction}>
        <input type="hidden" name="storeId" value={storeId} />
        <input type="hidden" name="orderDate" value={date} />
        <input type="hidden" name="version" value={currentVersion} />
        <input type="hidden" name="allowRevision" value="0" />
        <main className="page stack">
          <section className="panel stack no-print">
            <div className="row"><div><h2>Pedido de hoje</h2><p className="muted">{new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date(`${date}T12:00:00`))}</p><p className="muted">Compra: {new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date(`${cycleDate}T12:00:00`))} · prazo para alterações: {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(cutoffAt))}</p></div><div className="row"><Link href="/contagem" className="btn btn--secondary">Imprimir contagem</Link><Link href="/historico" className="btn btn--secondary">Histórico</Link></div></div>
            {feedback.message ? <p className={feedback.status === "error" ? "error" : feedback.status === "confirm" ? "warning" : "success"} role="status">{feedback.message}</p> : null}
            <label className="field"><span className="visually-hidden">Buscar produto</span><input className="search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar produto…" /></label>
            <div className="filters" aria-label="Filtrar produtos">
              {(["all", "empty", "filled"] as const).map((value) => <button key={value} className="filter" type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === "all" ? "Todos" : value === "empty" ? "Sem pedido" : "Com pedido"}</button>)}
            </div>
          </section>
          <section className="product-list" aria-live="polite">
            <div className="product-list__header" aria-hidden="true"><span>Produto</span><span>Estoque atual</span><span>Pedido</span></div>
            {visibleProducts.length === 0 ? <p className="muted empty-list">Nenhum produto encontrado para a busca/filtro atual.</p> : null}
            {visibleProducts.map((product) => {
              const value = values[product.id] ?? { stock: "", quantity: "" };
              return <article className="product-card" data-filled={Number(value.quantity) > 0} key={product.id}>
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
      {revisionDialogOpen && submitState.status === "confirm" ? <div className="dialog-backdrop" role="presentation"><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="revision-dialog-title" ref={dialogRef} tabIndex={-1}>
        <h2 id="revision-dialog-title">Já existe um pedido para esta compra</h2>
        <p>Já existe um pedido enviado para este ciclo.</p>
        {submitState.existingSubmittedAt ? <p>Pedido enviado em: <strong>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(submitState.existingSubmittedAt))}</strong></p> : null}
        {submitState.purchaseCycleDate ? <p>Compra: <strong>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date(`${submitState.purchaseCycleDate}T12:00:00`))}</strong></p> : null}
        <p>Deseja alterar o pedido existente?</p>
        <div className="row dialog-actions"><button className="btn btn--secondary" type="button" onClick={closeRevisionDialog} disabled={revisionSubmitting}>Voltar</button><button className="btn" type="button" onClick={confirmRevision} disabled={revisionSubmitting || submitting}>{revisionSubmitting ? "Alterando pedido…" : "Alterar pedido"}</button></div>
      </section></div> : null}
    </div>
  );
}
