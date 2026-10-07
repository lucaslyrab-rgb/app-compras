import { requirePermission } from "@/modules/identity/session";
import { parsePricingFilter, sanitizePricingQuery } from "@/modules/pricing/analysis/domain";
import { PricingWorkspace } from "@/modules/pricing/analysis/pricing-workspace";
import { loadPricingAnalyses } from "@/modules/pricing/analysis/service";

export const dynamic = "force-dynamic";

export default async function PricingPage({
  searchParams,
}: {
  searchParams?: Promise<{ filter?: string; q?: string }>;
}) {
  const principal = await requirePermission("gestor:precificacao");
  const params = searchParams ? await searchParams : undefined;
  const initialFilter = parsePricingFilter(params?.filter);
  const initialQuery = sanitizePricingQuery(params?.q);
  return (
    <PricingWorkspace
      key={`${initialFilter}:${initialQuery}`}
      analyses={await loadPricingAnalyses(principal)}
      initialFilter={initialFilter}
      initialQuery={initialQuery}
    />
  );
}
