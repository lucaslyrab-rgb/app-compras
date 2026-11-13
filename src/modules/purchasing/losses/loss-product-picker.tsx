"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ProductPhoto } from "@/components/product-photo";
import { PACKAGED_SECTION_LABEL, sortForOperationalLists, startsPackagedSection } from "@/modules/catalog/sections";

export type LossPickerProduct = {
  id: string;
  erpCode: number;
  name: string;
  unit: string;
  purchaseFormat?: string | null;
  isPackaged?: boolean;
  photoKey?: string | null;
  photoUpdatedAt?: string | null;
};

function normalize(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Filtra por nome (sem acentos) ou código ERP e ordena de A a Z, com os embalados no fim. */
export function filterLossProducts(products: LossPickerProduct[], query: string): LossPickerProduct[] {
  const q = normalize(query.trim());
  const sorted = sortForOperationalLists(products);
  if (!q) return sorted;
  return sorted.filter((p) => normalize(p.name).includes(q) || String(p.erpCode).includes(q));
}

/**
 * Escolha do produto da perda em uma folha que sobe de baixo: busca, os
 * produtos que chegaram na última compra (em fotos grandes) e a lista completa.
 */
export function LossProductPicker({
  products,
  recentProductIds,
  selectedProduct,
  onSelect,
}: {
  products: LossPickerProduct[];
  recentProductIds: string[];
  selectedProduct: LossPickerProduct | null;
  onSelect: (productId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const recent = useMemo(() => {
    const byId = new Map(products.map((p) => [p.id, p]));
    return recentProductIds.map((id) => byId.get(id)).filter((p): p is LossPickerProduct => Boolean(p));
  }, [products, recentProductIds]);
  const filtered = useMemo(() => filterLossProducts(products, query), [products, query]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    searchRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    const trigger = triggerRef.current;
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      trigger?.focus();
    };
  }, [open]);

  function choose(productId: string) {
    onSelect(productId);
    setOpen(false);
    setQuery("");
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`loss-picker-trigger${selectedProduct ? " loss-picker-trigger--selected" : ""}`}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        {selectedProduct ? (
          <>
            <ProductPhoto
              productId={selectedProduct.id}
              name={selectedProduct.name}
              photoKey={selectedProduct.photoKey}
              photoUpdatedAt={selectedProduct.photoUpdatedAt}
              size={44}
            />
            <span className="loss-picker-trigger__text">
              <strong>{selectedProduct.name}</strong>
              <span>ERP {selectedProduct.erpCode} · toque para trocar</span>
            </span>
          </>
        ) : (
          <span className="loss-picker-trigger__text">
            <strong>Escolher produto</strong>
            <span>Toque para ver as fotos ou buscar</span>
          </span>
        )}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>

      {open ? (
        <div
          className="loss-picker-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section className="loss-picker-sheet" role="dialog" aria-modal="true" aria-labelledby="loss-picker-title">
            <span className="loss-picker-sheet__grip" aria-hidden="true" />
            <div className="loss-picker-sheet__head">
              <div>
                <h2 id="loss-picker-title">Qual produto?</h2>
                <span>Toque na foto ou busque pelo nome</span>
              </div>
              <button type="button" className="loss-picker-close" aria-label="Fechar" onClick={() => setOpen(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <label className="loss-picker-search">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.5-3.5" />
              </svg>
              <input
                ref={searchRef}
                type="search"
                placeholder="Nome ou código ERP"
                aria-label="Buscar produto"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>

            <div className="loss-picker-sheet__scroll">
              {!query.trim() && recent.length > 0 ? (
                <>
                  <h3>Chegaram na última compra</h3>
                  <div className="loss-picker-grid">
                    {recent.map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        className={`loss-picker-tile${product.id === selectedProduct?.id ? " loss-picker-tile--selected" : ""}`}
                        onClick={() => choose(product.id)}
                      >
                        <ProductPhoto
                          productId={product.id}
                          name={product.name}
                          photoKey={product.photoKey}
                          photoUpdatedAt={product.photoUpdatedAt}
                          size={72}
                        />
                        <strong>{product.name}</strong>
                      </button>
                    ))}
                  </div>
                </>
              ) : null}

              <h3>{query.trim() ? `Resultado (${filtered.length})` : "Todos os produtos · A–Z"}</h3>
              {filtered.length > 0 ? (
                <ul className="loss-picker-list">
                  {filtered.map((product, index) => (
                    <Fragment key={product.id}>
                    {startsPackagedSection(filtered, index) ? <li className="packaged-heading">{PACKAGED_SECTION_LABEL}</li> : null}
                    <li>
                      <button
                        type="button"
                        className={product.id === selectedProduct?.id ? "loss-picker-row loss-picker-row--selected" : "loss-picker-row"}
                        onClick={() => choose(product.id)}
                      >
                        <ProductPhoto
                          productId={product.id}
                          name={product.name}
                          photoKey={product.photoKey}
                          photoUpdatedAt={product.photoUpdatedAt}
                          size={40}
                        />
                        <span>
                          <strong>{product.name}</strong>
                          <small>ERP {product.erpCode} · {product.unit}</small>
                        </span>
                      </button>
                    </li>
                    </Fragment>
                  ))}
                </ul>
              ) : (
                <p className="loss-picker-empty">Nenhum produto encontrado.</p>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
