import { requireManagerPrincipal } from "@/modules/identity/session";
import { ProductPricingWorkspace } from "@/modules/pricing/parameters/product-workspace";
import { listPricingProducts, readPricingSettings } from "@/modules/pricing/parameters/service";

export const dynamic = "force-dynamic";

export default async function ManagerProductsPage() {
  const principal = await requireManagerPrincipal();
  const [products, settings] = await Promise.all([listPricingProducts(principal), readPricingSettings(principal)]);
  return <ProductPricingWorkspace initialProducts={products} settings={settings} />;
}
