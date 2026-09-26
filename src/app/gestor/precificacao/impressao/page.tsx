import { requireManagerPrincipal } from "@/modules/identity/session";
import { formatPricingCurrency } from "@/modules/pricing/analysis/domain";
import { loadPricingAnalyses, loadPricingReviewDecisions } from "@/modules/pricing/analysis/service";
import { PrintPricingButton } from "./print-button";

export const dynamic = "force-dynamic";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function PricingPrintPage({ searchParams }: { searchParams: Promise<{ reviews?: string | string[] }> }) {
  const principal = await requireManagerPrincipal();
  const rawReviews = (await searchParams).reviews;
  const reviewIds = (Array.isArray(rawReviews) ? rawReviews : [rawReviews ?? ""])
    .flatMap((value) => value.split(","))
    .filter((value) => uuid.test(value))
    .slice(0, 50);
  if (reviewIds.length) {
    const decisions = await loadPricingReviewDecisions(principal, reviewIds);
    return <main className="pricing-print-report"><header><div><h1>Decisões de preços - FLV</h1><p>Revisões selecionadas • {new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p></div><PrintPricingButton /></header><table><thead><tr><th>ERP</th><th>Produto</th><th>Unidade</th><th>Custo efetivo</th><th>Preço calculado</th><th>Preço sugerido</th><th>Preço decidido</th><th>Origem</th><th>Anotação</th></tr></thead><tbody>{decisions.map((decision) => <tr key={decision.id}><td>{decision.erpCode}</td><td>{decision.productName}</td><td>{decision.saleUnit}</td><td>{formatPricingCurrency(decision.effectiveUnitCost)}</td><td>{formatPricingCurrency(decision.calculatedPrice)}</td><td>{formatPricingCurrency(decision.suggestedPrice)}</td><td><strong>{formatPricingCurrency(decision.decidedPrice)}</strong></td><td>{decision.decidedPrice ? (decision.decisionOrigin === "MANUAL" ? "Manual" : "Sugerido") : "—"}</td><td></td></tr>)}</tbody></table>{!decisions.length ? <p>Nenhuma decisão encontrada.</p> : null}</main>;
  }
  const pending = (await loadPricingAnalyses(principal)).filter((analysis) => analysis.calculation && analysis.status !== "REVIEWED");
  return <main className="pricing-print-report"><header><div><h1>Alterações de preços - FLV</h1><p>Produtos pendentes de revisão • {new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p></div><PrintPricingButton /></header><table><thead><tr><th>ERP</th><th>Produto</th><th>Unidade</th><th>Custo efetivo</th><th>Preço calculado</th><th>Preço sugerido</th><th>Anotação</th></tr></thead><tbody>{pending.map((analysis) => <tr key={analysis.id}><td>{analysis.erpCode}</td><td>{analysis.name}</td><td>{analysis.saleUnit}</td><td>{formatPricingCurrency(analysis.calculation!.effectiveUnitCost)}</td><td>{formatPricingCurrency(analysis.calculation!.calculatedPrice)}</td><td><strong>{formatPricingCurrency(analysis.calculation!.suggestedPrice)}</strong></td><td></td></tr>)}</tbody></table>{!pending.length ? <p>Nenhum produto pendente com preço calculável.</p> : null}</main>;
}
