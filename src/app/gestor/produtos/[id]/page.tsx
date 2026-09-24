import Link from "next/link";
import { notFound } from "next/navigation";
import { requireManagerPrincipal } from "@/modules/identity/session";
import { ProductPricingEditor } from "@/modules/pricing/parameters/product-editor";
import { readPricingProduct, readPricingSettings } from "@/modules/pricing/parameters/service";

export const dynamic = "force-dynamic";

export default async function ManagerProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requireManagerPrincipal();
  const { id } = await params;
  const [product, settings] = await Promise.all([readPricingProduct(principal, id), readPricingSettings(principal)]);
  if (!product) notFound();
  return <main className="manager-page manager-detail-page"><Link className="manager-back" href="/gestor/produtos">← Produtos</Link><div className="manager-breadcrumb">Gestor <span>›</span> Produtos <span>›</span> Editar</div><ProductPricingEditor product={product} settings={settings} /></main>;
}
