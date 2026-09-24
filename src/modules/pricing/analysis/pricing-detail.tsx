"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { simulateSellingPrice } from "../financial";
import { formatPricingCurrency, formatPricingNumber, type PricingAnalysis } from "./domain";
import { reviewPricingProductAction } from "./actions";

export function pricingStatusLabel(analysis: PricingAnalysis) {
  if (analysis.status === "NO_COST") return "Sem custo";
  if (analysis.status === "CONFIG_ERROR") return "Erro de configuração";
  if (analysis.status === "COST_CHANGED") return "Custo alterado";
  if (analysis.status === "PARAMETERS_CHANGED") return "Parâmetros alterados";
  if (analysis.status === "REVIEWED") return "Revisado";
  return "Não revisado";
}

export function pricingStatusTone(analysis: PricingAnalysis) {
  if (analysis.status === "COST_CHANGED" || analysis.status === "CONFIG_ERROR") return "danger";
  if (analysis.status === "REVIEWED") return "reviewed";
  if (analysis.status === "NO_COST") return "neutral";
  return "warning";
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short" }).format(new Date(value));
}

export function PricingDetail({ analysis, mobile = false }: { analysis: PricingAnalysis; mobile?: boolean }) {
  const router = useRouter();
  const [simulatedPrice, setSimulatedPrice] = useState(analysis.calculation?.suggestedPrice.replace(".", ",") ?? "");
  const [feedback, setFeedback] = useState("");
  const [pending, startTransition] = useTransition();
  const simulation = useMemo(() => {
    if (!analysis.calculation || !simulatedPrice.trim()) return null;
    try {
      return simulateSellingPrice({ effectiveUnitCost: analysis.calculation.effectiveUnitCost, operatingCostPercent: analysis.settings.operatingCostPercent, simulatedPrice: simulatedPrice.replace(",", ".") });
    } catch { return null; }
  }, [analysis.calculation, analysis.settings.operatingCostPercent, simulatedPrice]);

  function review() {
    if (!analysis.fingerprint) return;
    startTransition(async () => {
      const result = await reviewPricingProductAction({ productId: analysis.id, expectedFingerprint: analysis.fingerprint });
      if (result.status === "success") { setFeedback("Revisão registrada."); router.refresh(); }
      else setFeedback(result.message);
    });
  }

  return <section className={`pricing-detail${mobile ? " pricing-detail--mobile" : ""}`}>
    <header className="pricing-detail__header"><div className="manager-product-identity"><span className="manager-placeholder" aria-hidden="true">◌</span><div><h2>{analysis.name}</h2><p>ERP: {analysis.erpCode}</p></div></div><div className="pricing-detail__badges"><span className={`manager-badge manager-badge--${pricingStatusTone(analysis)}`}>{pricingStatusLabel(analysis)}</span>{analysis.conversionOrigin === "PROVISIONAL" ? <span className="manager-badge manager-badge--warning">Conversão padrão</span> : null}</div></header>
    <div className="pricing-section"><div className="pricing-section-title"><strong>Dados do produto</strong><Link className="manager-secondary" href={`/gestor/produtos/${analysis.id}`}>✎ Editar produto</Link></div><dl className="pricing-data-grid"><div><dt>Formato de compra</dt><dd>{analysis.purchaseFormat}</dd></div><div><dt>Unidade de venda</dt><dd>{analysis.saleUnit}</dd></div><div><dt>Conversão</dt><dd>1 {analysis.purchaseFormat} = {formatPricingNumber(analysis.conversionQuantity)} {analysis.saleUnit}</dd></div><div><dt>Perda média</dt><dd>{formatPricingNumber(analysis.beneficiationLossPercent)}%</dd></div><div><dt>Margem aplicada</dt><dd>{analysis.marginOrigin === "DEFAULT" ? "Padrão" : "Específica"} ({formatPricingNumber(analysis.desiredMarginPercent)}%)</dd></div></dl></div>
    {!analysis.officialCost ? <div className="pricing-no-cost"><strong>Sem custo oficial</strong><p>Este produto nunca foi marcado como comprado. Nenhum preço foi calculado.</p></div> : <>
      <div className="pricing-section"><strong>Último custo oficial</strong><dl className="pricing-data-grid pricing-data-grid--cost"><div><dt>Data/ciclo</dt><dd>{analysis.officialCost.cycleDate.split("-").reverse().join("/")}</dd></div><div><dt>Valor original</dt><dd>{formatPricingCurrency(analysis.officialCost.cost)} / {analysis.officialCost.costIsUnit ? analysis.saleUnit : analysis.purchaseFormat}</dd></div><div><dt>Custo informado é unitário</dt><dd>{analysis.officialCost.costIsUnit ? "Sim" : "Não"}</dd></div></dl>{analysis.stalePurchase ? <p className="pricing-stale-note">Sem compra recente — usando último custo de {dateLabel(analysis.officialCost.purchasedAt)}.</p> : null}</div>
      {analysis.calculation ? <>
        <div className="pricing-gross"><span>Custo unitário bruto (por {analysis.saleUnit.toLocaleLowerCase("pt-BR")})</span><strong>{formatPricingCurrency(analysis.calculation.grossUnitCost)}</strong><small>{formatPricingCurrency(analysis.officialCost.cost)} {analysis.officialCost.costIsUnit ? "já unitário" : `÷ ${formatPricingNumber(analysis.conversionQuantity)}`}</small></div>
        <div className="pricing-calculation"><strong>Cálculo da precificação</strong><dl><div><dt>Custo unitário bruto</dt><dd>{formatPricingCurrency(analysis.calculation.grossUnitCost)}</dd></div><div><dt>Perda média ({formatPricingNumber(analysis.beneficiationLossPercent)}%)</dt><dd>aplicada</dd></div><div><dt>Custo efetivo após perda</dt><dd>{formatPricingCurrency(analysis.calculation.effectiveUnitCost)}</dd></div><div><dt>Custo operacional</dt><dd>{formatPricingNumber(analysis.settings.operatingCostPercent)}%</dd></div><div><dt>Margem desejada</dt><dd>{formatPricingNumber(analysis.desiredMarginPercent)}%</dd></div><div><dt>Preço calculado</dt><dd>{formatPricingCurrency(analysis.calculation.calculatedPrice)}</dd></div></dl><div className="pricing-suggested"><span>Preço sugerido</span><strong>{formatPricingCurrency(analysis.calculation.suggestedPrice)}</strong></div></div>
        <details className="pricing-simulation" open><summary>Simulação de preço</summary><label><span>Preço de venda</span><span className="manager-input-group"><em>R$</em><input inputMode="decimal" value={simulatedPrice} onChange={(event) => setSimulatedPrice(event.target.value)} /></span></label>{simulation ? <dl><div><dt>Margem líquida</dt><dd>{formatPricingNumber(simulation.resultingMarginPercent)}%</dd></div><div><dt>Markup sobre custo</dt><dd>{formatPricingNumber(simulation.markupPercent)}%</dd></div></dl> : <p className="manager-feedback manager-feedback--error">Informe um preço positivo válido.</p>}<small>A simulação não altera os dados do produto.</small></details>
        <div className="pricing-review-actions">{feedback ? <p role="status">{feedback}</p> : null}<button type="button" className="manager-primary" onClick={review} disabled={pending || analysis.status === "REVIEWED"}>{pending ? "Salvando…" : analysis.status === "REVIEWED" ? "Preço revisado" : "Marcar como revisado"}</button></div>
      </> : <p className="manager-feedback manager-feedback--error">{analysis.calculationError}</p>}
    </>}
  </section>;
}
