"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatPricingCurrency, formatPricingNumber, filterPricingAnalyses, pricingMetrics, pricingStalePurchaseMessage, buildPricingDetailHref, buildPricingListHref, type PricingAnalysis, type PricingFilter } from "./domain";
import { PricingDetail, pricingStatusLabel, pricingStatusTone } from "./pricing-detail";

const filters: { value: PricingFilter; label: string }[] = [
  { value: "all", label: "Todos" }, { value: "cost-changed", label: "Custos alterados" }, { value: "stale-purchase", label: "Sem compra recente" }, { value: "not-reviewed", label: "Não revisados" }, { value: "reviewed", label: "Revisados" },
];

export function PricingWorkspace({ analyses, initialFilter = "all", initialQuery = "" }: { analyses: PricingAnalysis[]; initialFilter?: PricingFilter; initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<PricingFilter>(initialFilter);
  const [selectedId, setSelectedId] = useState(analyses.find((item) => item.reviewPending && item.costChanged)?.id ?? analyses[0]?.id ?? "");

  const syncUrl = (nextFilter: PricingFilter, nextQuery: string) => {
    if (typeof window !== "undefined") {
      const nextHref = buildPricingListHref(nextFilter, nextQuery);
      window.history.replaceState(null, "", nextHref);
    }
  };

  const updateQuery = (nextQuery: string) => {
    const clean = nextQuery.slice(0, 100);
    setQuery(clean);
    syncUrl(filter, clean);
  };

  const updateFilter = (nextFilter: PricingFilter) => {
    setFilter(nextFilter);
    syncUrl(nextFilter, query);
  };


  const visible = useMemo(() => filterPricingAnalyses(analyses, query, filter), [analyses, query, filter]);
  const metrics = useMemo(() => pricingMetrics(analyses), [analyses]);
  const selected = analyses.find((item) => item.id === selectedId) ?? visible[0] ?? analyses[0];
  const referenceCycleLabel = analyses[0]?.referenceCycleDate?.split("-").reverse().join("/") ?? "sem ciclo oficial";
  const count = (value: PricingFilter) => value === "all" ? metrics.total : value === "cost-changed" ? metrics.costChanged : value === "stale-purchase" ? metrics.stalePurchase : value === "reviewed" ? metrics.reviewed : analyses.filter((item) => item.reviewPending).length;
  return <main className="manager-page">
    <div className="manager-breadcrumb">Gestor <span>›</span> Precificação</div>
    <header className="manager-heading"><div><h1>Precificação - FLV</h1><p>Calcule, revise e defina os preços de venda com base no custo, perda e margem.</p></div></header>
    {analyses[0] ? <section className="manager-settings-summary"><div><strong>Configurações da precificação (FLV)</strong><dl><div><dt>Custo operacional</dt><dd>{formatPricingNumber(analyses[0].settings.operatingCostPercent)}%</dd></div><div><dt>Margem padrão</dt><dd>{formatPricingNumber(analyses[0].settings.defaultMarginPercent)}%</dd></div><div><dt>Arredondamento comercial</dt><dd>,20 até ,60 → X,49<br />Demais casos → X,99</dd></div></dl></div><Link className="manager-secondary" href="/gestor/configuracoes">⚙ Editar configurações</Link></section> : null}
    <div className="manager-two-column pricing-columns"><section className="manager-list-area">
      <div className="manager-metrics pricing-metrics"><article><strong>{metrics.total}</strong><span>Produtos</span></article><article className="metric-danger"><strong>{metrics.costChanged}</strong><span>Custos alterados</span><small>Precisa revisar</small></article><article className="metric-warning"><strong>{metrics.stalePurchase}</strong><span>Sem compra recente</span><small>Usando último custo</small></article><article className="metric-success"><strong>{metrics.reviewed}</strong><span>Revisados</span><small>Neste estado</small></article></div>
      <Link className="pricing-print-link" href="/gestor/precificacao/impressao" target="_blank">▣ Imprimir alterações de preço <small>Revisões concluídas após mudança de custo no ciclo {referenceCycleLabel}</small></Link>
      <input className="manager-search" type="search" placeholder="Buscar por produto, ERP ou formato..." maxLength={100} value={query} onChange={(event) => updateQuery(event.target.value)} />
      <div className="manager-filters">{filters.map((item) => <button type="button" key={item.value} aria-pressed={filter === item.value} onClick={() => updateFilter(item.value)}>{item.label} ({count(item.value)})</button>)}</div>
      <div className="manager-table-wrap"><table className="manager-table pricing-table"><thead><tr><th>ERP</th><th>Produto</th><th>Formato</th><th>Unidade</th><th>Último custo</th><th>Custo bruto</th><th>Custo efetivo</th><th>Preço calculado</th><th>Preço sugerido</th><th>Último preço decidido</th><th>Status</th><th>Revisado em</th><th>Ações</th></tr></thead><tbody>{visible.map((analysis) => <tr key={analysis.id} data-attention={analysis.status === "COST_CHANGED"} data-selected={selected?.id === analysis.id}><td>{analysis.erpCode}</td><th scope="row">{analysis.name}</th><td>{analysis.purchaseFormat}</td><td>{analysis.saleUnit}</td><td>{formatPricingCurrency(analysis.officialCost?.cost ?? null)}</td><td>{formatPricingCurrency(analysis.calculation?.grossUnitCost ?? null)}</td><td>{formatPricingCurrency(analysis.calculation?.effectiveUnitCost ?? null)}</td><td>{formatPricingCurrency(analysis.calculation?.calculatedPrice ?? null)}</td><td><strong>{formatPricingCurrency(analysis.calculation?.suggestedPrice ?? null)}</strong></td><td><strong>{formatPricingCurrency(analysis.latestReview?.decidedPrice ?? null)}</strong></td><td><span className={`manager-badge manager-badge--${pricingStatusTone(analysis)}`}>{pricingStatusLabel(analysis)}</span>{pricingStalePurchaseMessage(analysis) ? <small className="pricing-stale-inline">{pricingStalePurchaseMessage(analysis)}</small> : null}</td><td>{analysis.latestReview ? new Date(analysis.latestReview.reviewedAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—"}</td><td><button className="manager-icon-button" type="button" aria-label={`Analisar ${analysis.name}`} onClick={() => setSelectedId(analysis.id)}>✎</button></td></tr>)}</tbody></table></div>
      <div className="manager-mobile-cards">{visible.map((analysis) => <article key={analysis.id} className="manager-mobile-card pricing-card"><header><div><h2>{analysis.name}</h2><p>ERP {analysis.erpCode}</p></div><span className={`manager-badge manager-badge--${pricingStatusTone(analysis)}`}>{pricingStatusLabel(analysis)}</span></header>{pricingStalePurchaseMessage(analysis) ? <p className="pricing-stale-note">{pricingStalePurchaseMessage(analysis)}</p> : null}<dl><div><dt>Última compra</dt><dd>{formatPricingCurrency(analysis.officialCost?.cost ?? null)}</dd></div><div><dt>Conversão</dt><dd>{formatPricingNumber(analysis.conversionQuantity)} {analysis.saleUnit}</dd></div><div><dt>Perda</dt><dd>{formatPricingNumber(analysis.beneficiationLossPercent)}%</dd></div><div><dt>Custo bruto</dt><dd>{formatPricingCurrency(analysis.calculation?.grossUnitCost ?? null)}</dd></div><div><dt>Custo efetivo</dt><dd>{formatPricingCurrency(analysis.calculation?.effectiveUnitCost ?? null)}</dd></div><div><dt>Preço calculado</dt><dd>{formatPricingCurrency(analysis.calculation?.calculatedPrice ?? null)}</dd></div><div className="pricing-card-suggested"><dt>Preço sugerido</dt><dd>{formatPricingCurrency(analysis.calculation?.suggestedPrice ?? null)}</dd></div><div><dt>Último preço decidido</dt><dd>{formatPricingCurrency(analysis.latestReview?.decidedPrice ?? null)}</dd></div></dl><Link className="manager-primary" href={buildPricingDetailHref(analysis.id, filter, query)}>Analisar precificação</Link></article>)}</div>
      {!visible.length ? <p className="manager-empty">Nenhum produto encontrado.</p> : null}
    </section>{selected ? <PricingDetail key={selected.id} analysis={selected} /> : null}</div>
  </main>;
}
