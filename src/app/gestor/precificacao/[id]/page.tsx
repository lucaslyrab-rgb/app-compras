import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/modules/identity/session";
import { resolvePricingBackHref } from "@/modules/pricing/analysis/domain";
import { PricingDetail } from "@/modules/pricing/analysis/pricing-detail";
import { loadPricingAnalysis } from "@/modules/pricing/analysis/service";

export const dynamic = "force-dynamic";

export default async function PricingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ filter?: string; q?: string }>;
}) {
  const principal = await requirePermission("gestor:precificacao");
  const { id } = await params;
  const sp = searchParams ? await searchParams : undefined;
  const analysis = await loadPricingAnalysis(principal, id);
  if (!analysis) notFound();
  const backHref = resolvePricingBackHref(sp);
  return (
    <main className="manager-page manager-detail-page pricing-mobile-page">
      <Link className="manager-back" href={backHref}>
        ← Precificação
      </Link>
      <div className="manager-breadcrumb">Gestor <span>›</span> Precificação <span>›</span> Análise</div>
      <PricingDetail analysis={analysis} mobile />
    </main>
  );
}
