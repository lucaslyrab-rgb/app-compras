import { requireManagerPrincipal } from "@/modules/identity/session";
import { formatPricingCurrency, printablePricingAnalyses } from "@/modules/pricing/analysis/domain";
import { loadPricingAnalyses } from "@/modules/pricing/analysis/service";
import { PrintPricingButton } from "./print-button";

export const dynamic = "force-dynamic";

export default async function PricingPrintPage() {
  const principal = await requireManagerPrincipal();
  const reviewed = printablePricingAnalyses(await loadPricingAnalyses(principal));
  return <main className="pricing-print-report"><header><div><h1>Alterações de preços - FLV</h1><p>Preços revisados para atualização no ERP • {new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p></div><PrintPricingButton /></header><table><thead><tr><th>ERP</th><th>Produto</th><th>Unidade</th><th>Custo efetivo</th><th>Preço calculado</th><th>Preço sugerido</th><th>Preço aplicado</th></tr></thead><tbody>{reviewed.map((analysis) => <tr key={analysis.id}><td>{analysis.erpCode}</td><td>{analysis.name}</td><td>{analysis.saleUnit}</td><td>{formatPricingCurrency(analysis.latestReview!.effectiveUnitCost)}</td><td>{formatPricingCurrency(analysis.latestReview!.calculatedPrice)}</td><td>{formatPricingCurrency(analysis.latestReview!.suggestedPrice)}</td><td><strong>{formatPricingCurrency(analysis.latestReview!.appliedPrice)}</strong></td></tr>)}</tbody></table>{!reviewed.length ? <p>Nenhum preço revisado para impressão.</p> : null}</main>;
}
