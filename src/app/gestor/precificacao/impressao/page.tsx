import { requireManagerPrincipal } from "@/modules/identity/session";
import { formatPricingCurrency } from "@/modules/pricing/analysis/domain";
import { loadPricingAnalyses } from "@/modules/pricing/analysis/service";
import { PrintPricingButton } from "./print-button";

export const dynamic = "force-dynamic";

export default async function PricingPrintPage() {
  const principal = await requireManagerPrincipal();
  const pending = (await loadPricingAnalyses(principal)).filter((analysis) => analysis.calculation && analysis.status !== "REVIEWED");
  return <main className="pricing-print-report"><header><div><h1>Alterações de preços - FLV</h1><p>Produtos pendentes de revisão • {new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p></div><PrintPricingButton /></header><table><thead><tr><th>ERP</th><th>Produto</th><th>Unidade</th><th>Custo efetivo</th><th>Preço calculado</th><th>Preço sugerido</th><th>Anotação</th></tr></thead><tbody>{pending.map((analysis) => <tr key={analysis.id}><td>{analysis.erpCode}</td><td>{analysis.name}</td><td>{analysis.saleUnit}</td><td>{formatPricingCurrency(analysis.calculation!.effectiveUnitCost)}</td><td>{formatPricingCurrency(analysis.calculation!.calculatedPrice)}</td><td><strong>{formatPricingCurrency(analysis.calculation!.suggestedPrice)}</strong></td><td></td></tr>)}</tbody></table>{!pending.length ? <p>Nenhum produto pendente com preço calculável.</p> : null}</main>;
}
