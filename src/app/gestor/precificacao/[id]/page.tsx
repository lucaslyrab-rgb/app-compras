import Link from "next/link";
import { notFound } from "next/navigation";
import { requireManagerPrincipal } from "@/modules/identity/session";
import { PricingDetail } from "@/modules/pricing/analysis/pricing-detail";
import { loadPricingAnalysis } from "@/modules/pricing/analysis/service";

export const dynamic = "force-dynamic";

export default async function PricingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requireManagerPrincipal();
  const { id } = await params;
  const analysis = await loadPricingAnalysis(principal, id);
  if (!analysis) notFound();
  return <main className="manager-page manager-detail-page pricing-mobile-page"><Link className="manager-back" href="/gestor/precificacao">← Precificação</Link><div className="manager-breadcrumb">Gestor <span>›</span> Precificação <span>›</span> Análise</div><PricingDetail analysis={analysis} mobile /></main>;
}
