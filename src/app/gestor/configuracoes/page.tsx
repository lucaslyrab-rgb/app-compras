import { requireManagerPrincipal } from "@/modules/identity/session";
import { PricingSettingsForm } from "@/modules/pricing/parameters/settings-form";
import { readPricingSettings } from "@/modules/pricing/parameters/service";

export const dynamic = "force-dynamic";

export default async function PricingSettingsPage() {
  const principal = await requireManagerPrincipal();
  const settings = await readPricingSettings(principal);
  return <main className="manager-page manager-settings-page"><div className="manager-breadcrumb">Gestor <span>›</span> Configurações</div><header className="manager-heading"><div><h1>Configurações de Precificação - FLV</h1><p>Defina os percentuais globais utilizados quando o produto não possui margem específica.</p></div></header><section className="manager-panel"><PricingSettingsForm initial={settings} /></section></main>;
}
