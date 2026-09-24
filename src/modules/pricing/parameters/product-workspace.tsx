"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatPricingNumber } from "../analysis/domain";
import { ProductPricingEditor } from "./product-editor";
import { filterPricingProducts, pricingProductMetrics, pricingProductStatus, type PricingProduct, type PricingSettings, type ProductPricingFilter } from "./domain";

const filters: { value: ProductPricingFilter; label: string }[] = [
  { value: "all", label: "Todos" }, { value: "provisional", label: "Conversão padrão" }, { value: "unit", label: "Unitários" }, { value: "configured", label: "Configurados" },
];
function statusLabel(product: PricingProduct) {
  return product.conversionOrigin === "PROVISIONAL" ? "Padrão" : product.conversionOrigin === "UNIT" ? "Unitário" : "Configurado";
}

export function ProductPricingWorkspace({ initialProducts, settings }: { initialProducts: PricingProduct[]; settings: PricingSettings }) {
  const [products, setProducts] = useState(initialProducts);
  const [selectedId, setSelectedId] = useState(initialProducts[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ProductPricingFilter>("all");
  const visible = useMemo(() => filterPricingProducts(products, query, filter), [products, query, filter]);
  const metrics = useMemo(() => pricingProductMetrics(products), [products]);
  const selected = products.find((product) => product.id === selectedId) ?? visible[0] ?? products[0];
  const filterCount = (value: ProductPricingFilter) => value === "all" ? metrics.total : value === "provisional" ? metrics.provisional : value === "unit" ? metrics.unit : metrics.configured;
  function saved(updated: PricingProduct) { setProducts((current) => current.map((product) => product.id === updated.id ? updated : product)); }
  return <main className="manager-page">
    <div className="manager-breadcrumb">Gestor <span>›</span> Produtos</div>
    <header className="manager-heading"><div><h1>Cadastro de Produtos - FLV</h1><p>Configure a conversão, perda e margem de cada produto para a precificação.</p></div></header>
    <section className="manager-settings-summary"><div><strong>Configurações gerais da precificação (FLV)</strong><dl><div><dt>Custo operacional</dt><dd>{formatPricingNumber(settings.operatingCostPercent)}%</dd></div><div><dt>Margem padrão</dt><dd>{formatPricingNumber(settings.defaultMarginPercent)}%</dd></div><div><dt>Arredondamento comercial</dt><dd>,20 até ,60 → X,49<br />Demais casos → X,99</dd></div></dl></div><Link className="manager-secondary" href="/gestor/configuracoes">⚙ Editar configurações</Link></section>
    <div className="manager-two-column"><section className="manager-list-area">
      <div className="manager-metrics"><article><strong>{metrics.total}</strong><span>Produtos</span></article><article className="metric-warning"><strong>{metrics.provisional}</strong><span>Conversão padrão</span><small>(CX/SC = 20 kg)</small></article><article className="metric-info"><strong>{metrics.unit}</strong><span>Unitários</span><small>(UND/PCT/BDJ)</small></article><article className="metric-success"><strong>{metrics.configured}</strong><span>Configurados</span><small>(manualmente)</small></article></div>
      <input className="manager-search" type="search" placeholder="Buscar por produto, ERP ou formato..." value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="manager-filters" aria-label="Filtros de produto">{filters.map((item) => <button type="button" key={item.value} aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label} ({filterCount(item.value)})</button>)}</div>
      <div className="manager-table-wrap"><table className="manager-table manager-product-table"><thead><tr><th>ERP</th><th>Produto</th><th>Formato compra</th><th>Unidade venda</th><th>Conversão</th><th>Perda (%)</th><th>Margem</th><th>Status</th><th>Ações</th></tr></thead><tbody>{visible.map((product) => <tr key={product.id} data-selected={selected?.id === product.id}><td>{product.erpCode}</td><th scope="row"><span className="manager-product-cell"><span className="manager-placeholder manager-placeholder--small">◌</span>{product.name}</span></th><td><span className="manager-format">{product.purchaseFormat}</span></td><td>{product.saleUnit}</td><td>{formatPricingNumber(product.conversionQuantity)} {product.saleUnit.toLocaleLowerCase("pt-BR")}</td><td>{formatPricingNumber(product.beneficiationLossPercent, 1)}</td><td>{product.specificMarginPercent ? `${formatPricingNumber(product.specificMarginPercent)}%` : "Padrão"}</td><td><span className={`manager-badge manager-badge--${pricingProductStatus(product)}`}>{statusLabel(product)}</span></td><td><button type="button" className="manager-icon-button" aria-label={`Editar ${product.name}`} onClick={() => setSelectedId(product.id)}>✎</button></td></tr>)}</tbody></table></div>
      <div className="manager-mobile-cards">{visible.map((product) => <article key={product.id} className="manager-mobile-card"><header><div><h2>{product.name}</h2><p>ERP {product.erpCode}</p></div><span className={`manager-badge manager-badge--${pricingProductStatus(product)}`}>{statusLabel(product)}</span></header><dl><div><dt>Compra</dt><dd>{product.purchaseFormat}</dd></div><div><dt>Conversão</dt><dd>{formatPricingNumber(product.conversionQuantity)} {product.saleUnit}</dd></div><div><dt>Perda</dt><dd>{formatPricingNumber(product.beneficiationLossPercent)}%</dd></div><div><dt>Margem</dt><dd>{product.specificMarginPercent ? `${formatPricingNumber(product.specificMarginPercent)}%` : `Padrão ${formatPricingNumber(settings.defaultMarginPercent)}%`}</dd></div></dl><Link className="manager-secondary" href={`/gestor/produtos/${product.id}`}>Editar</Link></article>)}</div>
      {!visible.length ? <p className="manager-empty">Nenhum produto encontrado.</p> : null}
    </section>{selected ? <ProductPricingEditor key={selected.id} product={selected} settings={settings} onSaved={saved} /> : null}</div>
  </main>;
}
