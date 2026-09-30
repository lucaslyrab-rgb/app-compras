import { requirePermission } from "@/modules/identity/session";
import { formatPricingCurrency, pricingPrintRows } from "@/modules/pricing/analysis/domain";
import { loadPricingAnalyses } from "@/modules/pricing/analysis/service";
import { PrintPricingButton } from "./print-button";

export const dynamic = "force-dynamic";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function PricingPrintPage({ searchParams }: { searchParams: Promise<{ reviews?: string | string[] }> }) {
  const principal = await requirePermission("gestor:precificacao");
  const rawReviews = (await searchParams).reviews;
  const reviewIds = (Array.isArray(rawReviews) ? rawReviews : [rawReviews ?? ""])
    .flatMap((value) => value.split(","))
    .filter((value) => uuid.test(value))
    .slice(0, 50);
  const analyses = await loadPricingAnalyses(principal);
  const decisions = pricingPrintRows(analyses, reviewIds);
  const referenceCycle = analyses.find((analysis) => analysis.referenceCycleDate)?.referenceCycleDate ?? null;
  const cycleLabel = referenceCycle ? referenceCycle.split("-").reverse().join("/") : "sem ciclo oficial";
  const scope = reviewIds.length ? "Alterações selecionadas e confirmadas" : "Alterações confirmadas na rodada atual";
  return <main className="pricing-print-report"><header><div><h1>Alterações de preços - FLV</h1><p>{scope} • Ciclo {cycleLabel}</p></div><PrintPricingButton /></header><table><thead><tr><th>ERP</th><th>Produto</th><th>Unidade</th><th>Custo efetivo</th><th>Preço calculado</th><th>Preço sugerido</th><th>Preço decidido</th><th>Origem</th><th>Anotação</th></tr></thead><tbody>{decisions.map((decision) => <tr key={decision.reviewId}><td>{decision.erpCode}</td><td>{decision.productName}</td><td>{decision.saleUnit}</td><td>{formatPricingCurrency(decision.effectiveUnitCost)}</td><td>{formatPricingCurrency(decision.calculatedPrice)}</td><td>{formatPricingCurrency(decision.suggestedPrice)}</td><td><strong>{formatPricingCurrency(decision.decidedPrice)}</strong></td><td>{decision.decisionOrigin === "MANUAL" ? "Manual" : "Sugerido"}</td><td></td></tr>)}</tbody></table>{!decisions.length ? <p>Nenhuma alteração de preço confirmada para o ciclo {cycleLabel}.</p> : null}</main>;
}
