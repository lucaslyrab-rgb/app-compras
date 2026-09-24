import { requireManagerPrincipal } from "@/modules/identity/session";
import { PricingWorkspace } from "@/modules/pricing/analysis/pricing-workspace";
import { loadPricingAnalyses } from "@/modules/pricing/analysis/service";

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const principal = await requireManagerPrincipal();
  return <PricingWorkspace analyses={await loadPricingAnalyses(principal)} />;
}
