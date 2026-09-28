import { requireManagerPrincipal } from "@/modules/identity/session";
import { formatPricingCurrency, pricingPrintRows } from "@/modules/pricing/analysis/domain";
import { loadPricingAnalyses } from "@/modules/pricing/analysis/service";
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
  const decisions = pricingPrintRows(await loadPricingAnalyses(principal), reviewIds);
  const date = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const scope = reviewIds.length ? "Decisões selecionadas e confirmadas" : "Decisões confirmadas no estado econômico atual";
  return <main className="pricing-print-report"><header><div><h1>Decisões de preços - FLV</h1><p>{scope} • {date}</p></div><PrintPricingButton /></header><table><thead><tr><th>ERP</th><th>Produto</th><th>Unidade</th><th>Custo efetivo</th><th>Preço calculado</th><th>Preço sugerido</th><th>Preço decidido</th><th>Origem</th><th>Anotação</th></tr></thead><tbody>{decisions.map((decision) => <tr key={decision.reviewId}><td>{decision.erpCode}</td><td>{decision.productName}</td><td>{decision.saleUnit}</td><td>{formatPricingCurrency(decision.effectiveUnitCost)}</td><td>{formatPricingCurrency(decision.calculatedPrice)}</td><td>{formatPricingCurrency(decision.suggestedPrice)}</td><td><strong>{formatPricingCurrency(decision.decidedPrice)}</strong></td><td>{decision.decisionOrigin === "MANUAL" ? "Manual" : "Sugerido"}</td><td></td></tr>)}</tbody></table>{!decisions.length ? <p>Nenhuma decisão atual confirmada.</p> : null}</main>;
}
