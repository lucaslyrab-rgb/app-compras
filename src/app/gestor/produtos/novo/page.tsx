import Link from "next/link";
import { requirePermission } from "@/modules/identity/session";
import { ProductPricingEditor } from "@/modules/pricing/parameters/product-editor";
import { readPricingSettings } from "@/modules/pricing/parameters/service";

export const dynamic = "force-dynamic";

export default async function NewManagerProductPage() {
  const principal = await requirePermission("gestor:produtos");
  const settings = await readPricingSettings(principal);
  return <main className="manager-page manager-detail-page"><Link className="manager-back" href="/gestor/produtos">← Produtos</Link><div className="manager-breadcrumb">Gestor <span>›</span> Produtos <span>›</span> Novo</div><ProductPricingEditor key="new-product" settings={settings} /></main>;
}
