"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { toggleProductAction } from "@/modules/catalog/actions";
import { formatPricingNumber } from "../analysis/domain";
import { ProductPricingEditor } from "./product-editor";
import { ProductPhoto } from "@/components/product-photo";
import {
  filterPricingProducts, paginatePricingProducts, pricingProductMetrics, pricingProductStatus,
  type PricingProduct, type PricingSettings, type ProductPricingFilter, type ProductStatusFilter,
} from "./domain";

const filters: { value: ProductPricingFilter; label: string }[] = [
  { value: "all", label: "Todos" }, { value: "provisional", label: "Conversão padrão" },
  { value: "unit", label: "Unitários" }, { value: "configured", label: "Configurados" },
];
const statusFilters: { value: ProductStatusFilter; label: string }[] = [
  { value: "active", label: "Ativos" }, { value: "inactive", label: "Inativos" }, { value: "all", label: "Todos os status" },
];
function statusLabel(product: PricingProduct) {
  return product.conversionOrigin === "PROVISIONAL" ? "Padrão" : product.conversionOrigin === "UNIT" ? "Unitário" : "Configurado";
}

export function ProductPricingWorkspace({ initialProducts, settings }: { initialProducts: PricingProduct[]; settings: PricingSettings }) {
  const [products, setProducts] = useState(initialProducts);
  const [selectedId, setSelectedId] = useState(initialProducts[0]?.id ?? "");
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ProductPricingFilter>("all");
  const [statusFilter, setStatusFilter] = useState<ProductStatusFilter>("active");
  const [page, setPage] = useState(1);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const filtered = useMemo(() => filterPricingProducts(products, query, filter, statusFilter), [products, query, filter, statusFilter]);
  const pagination = useMemo(() => paginatePricingProducts(filtered, page), [filtered, page]);
  const visible = pagination.items;
  const metrics = useMemo(() => pricingProductMetrics(products), [products]);
  const selectedCandidate = products.find((product) => product.id === selectedId);
  const selected = selectedCandidate && visible.some((product) => product.id === selectedCandidate.id) ? selectedCandidate : visible[0];
  const filterCount = (value: ProductPricingFilter) => filterPricingProducts(products, "", value, statusFilter).length;

  function resetAnd(action: () => void) { action(); setPage(1); setCreating(false); }
  function saved(updated: PricingProduct) {
    const next = products.map((product) => product.id === updated.id ? updated : product)
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR") || a.erpCode - b.erpCode);
    setProducts(next);
    setSelectedId(updated.id);
    const filteredNext = filterPricingProducts(next, query, filter, statusFilter);
    const index = filteredNext.findIndex((product) => product.id === updated.id);
    if (index >= 0) {
      setPage(Math.floor(index / 20) + 1);
    }
  }
  function created(value: PricingProduct) {
    const next = [...products, value].sort((a, b) => a.name.localeCompare(b.name, "pt-BR") || a.erpCode - b.erpCode);
    setProducts(next);
    setSelectedId(value.id); setStatusFilter("active"); setFilter("all"); setQuery("");
    setPage(Math.floor(next.findIndex((product) => product.id === value.id) / 20) + 1);
    setCreating(false);
  }
  function toggle(product: PricingProduct) {
    setFeedback(null);
    startTransition(async () => {
      const result = await toggleProductAction({ productId: product.id, active: !product.active, expectedVersion: product.productVersion });
      if (result.status === "success") {
        setProducts((current) => current.map((item) => item.id === product.id ? { ...item, active: result.value.active, productVersion: result.value.version } : item));
      } else setFeedback(result.message);
    });
  }

  return <main className="manager-page">
    <div className="manager-breadcrumb">Gestor <span>›</span> Produtos</div>
    <header className="manager-heading"><div><h1>Cadastro de Produtos - FLV</h1><p>Cadastre produtos e mantenha os dados usados nos pedidos e na precificação.</p></div><button type="button" className="manager-primary manager-new-desktop" onClick={() => setCreating(true)}>+ Novo produto</button><Link className="manager-primary manager-new-mobile" href="/gestor/produtos/novo">+ Novo produto</Link></header>
    <section className="manager-settings-summary"><div><strong>Configurações gerais da precificação (FLV)</strong><dl><div><dt>Custo operacional</dt><dd>{formatPricingNumber(settings.operatingCostPercent)}%</dd></div><div><dt>Margem padrão</dt><dd>{formatPricingNumber(settings.defaultMarginPercent)}%</dd></div><div><dt>Arredondamento comercial</dt><dd>,20 até ,60 → X,49<br />Demais casos → X,99</dd></div></dl></div><Link className="manager-secondary" href="/gestor/configuracoes">⚙ Editar configurações</Link></section>
    <div className="manager-two-column"><section className="manager-list-area">
      <div className="manager-metrics"><article><strong>{metrics.total}</strong><span>Produtos</span></article><article className="metric-success"><strong>{metrics.active}</strong><span>Ativos</span></article><article className="metric-warning"><strong>{metrics.inactive}</strong><span>Inativos</span></article><article className="metric-info"><strong>{metrics.configured}</strong><span>Configurados</span><small>(manualmente)</small></article></div>
      <input className="manager-search" type="search" placeholder="Buscar por produto, ERP ou formato..." value={query} onChange={(event) => resetAnd(() => setQuery(event.target.value))} />
      <div className="manager-filter-row"><div className="manager-filters" aria-label="Filtros de configuração">{filters.map((item) => <button type="button" key={item.value} aria-pressed={filter === item.value} onClick={() => resetAnd(() => setFilter(item.value))}>{item.label} ({filterCount(item.value)})</button>)}</div><label className="manager-status-filter"><span>Status</span><select value={statusFilter} onChange={(event) => resetAnd(() => setStatusFilter(event.target.value as ProductStatusFilter))}>{statusFilters.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div>
      {feedback ? <p role="status" className="manager-feedback manager-feedback--error">{feedback}</p> : null}
      <div className="manager-table-wrap"><table className="manager-table manager-product-table"><thead><tr><th>ERP</th><th>Produto</th><th>Formato</th><th>Un. venda</th><th>Conversão</th><th>Perda</th><th>Margem</th><th>Status</th><th>Ações</th></tr></thead><tbody>{visible.map((product) => <tr key={product.id} data-selected={selected?.id === product.id} data-inactive={!product.active}><td>{product.erpCode}</td><th scope="row"><span className="manager-product-cell"><ProductPhoto productId={product.id} name={product.name} photoKey={product.photoKey} photoUpdatedAt={product.photoUpdatedAt} size={28} thumbnailClassName="manager-photo-thumb" />{product.name}</span></th><td><span className="manager-format">{product.purchaseFormat}</span></td><td>{product.saleUnit}</td><td>{formatPricingNumber(product.conversionQuantity)} {product.saleUnit.toLocaleLowerCase("pt-BR")}</td><td>{formatPricingNumber(product.beneficiationLossPercent, 1)}</td><td>{product.specificMarginPercent ? `${formatPricingNumber(product.specificMarginPercent)}%` : "Padrão"}</td><td><span className={`manager-badge ${product.active ? `manager-badge--${pricingProductStatus(product)}` : "manager-badge--neutral"}`}>{product.active ? statusLabel(product) : "Inativo"}</span></td><td><span className="manager-row-actions"><button type="button" className="manager-icon-button" aria-label={`Editar ${product.name}`} onClick={() => { setCreating(false); setSelectedId(product.id); }}>✎</button><button type="button" className="manager-secondary manager-status-button" disabled={pending} onClick={() => toggle(product)}>{product.active ? "Inativar" : "Reativar"}</button></span></td></tr>)}</tbody></table></div>
      <div className="manager-mobile-cards">{visible.map((product) => <article key={product.id} className="manager-mobile-card"><header><div className="manager-mobile-card-title"><ProductPhoto productId={product.id} name={product.name} photoKey={product.photoKey} photoUpdatedAt={product.photoUpdatedAt} size={36} thumbnailClassName="manager-photo-thumb" /><div><h2>{product.name}</h2><p>ERP {product.erpCode}</p></div></div><span className={`manager-badge ${product.active ? `manager-badge--${pricingProductStatus(product)}` : "manager-badge--neutral"}`}>{product.active ? statusLabel(product) : "Inativo"}</span></header><dl><div><dt>Compra</dt><dd>{product.purchaseFormat}</dd></div><div><dt>Conversão</dt><dd>{formatPricingNumber(product.conversionQuantity)} {product.saleUnit}</dd></div><div><dt>Perda</dt><dd>{formatPricingNumber(product.beneficiationLossPercent)}%</dd></div><div><dt>Margem</dt><dd>{product.specificMarginPercent ? `${formatPricingNumber(product.specificMarginPercent)}%` : `Padrão ${formatPricingNumber(settings.defaultMarginPercent)}%`}</dd></div></dl><div className="manager-card-actions"><Link className="manager-secondary" href={`/gestor/produtos/${product.id}`}>Editar</Link><button type="button" className="manager-secondary" disabled={pending} onClick={() => toggle(product)}>{product.active ? "Inativar" : "Reativar"}</button></div></article>)}</div>
      {!visible.length ? <p className="manager-empty">Nenhum produto encontrado.</p> : null}
      {pagination.total ? <nav className="manager-pagination" aria-label="Paginação de produtos"><span>{pagination.start + 1}–{pagination.end} de {pagination.total}</span><div><button type="button" className="manager-secondary" disabled={pagination.currentPage === 1} onClick={() => setPage(pagination.currentPage - 1)}>Anterior</button><span>Página {pagination.currentPage} de {pagination.pageCount}</span><button type="button" className="manager-secondary" disabled={pagination.currentPage === pagination.pageCount} onClick={() => setPage(pagination.currentPage + 1)}>Próxima</button></div></nav> : null}
    </section>{creating ? <ProductPricingEditor key="create-product" settings={settings} onCreated={created} onCancel={() => setCreating(false)} /> : selected ? <ProductPricingEditor key={selected.id} product={selected} settings={settings} onSaved={saved} /> : null}</div>
  </main>;
}
