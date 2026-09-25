import { requireManagerPrincipal } from "@/modules/identity/session";
import { PurchaseCalendarForm } from "@/modules/ordering/calendar/calendar-form";
import { readPurchaseCalendarForManagement } from "@/modules/ordering/calendar/service";
import { PricingSettingsForm } from "@/modules/pricing/parameters/settings-form";
import { readPricingSettings } from "@/modules/pricing/parameters/service";

export const dynamic = "force-dynamic";

export default async function PricingSettingsPage() {
  const principal = await requireManagerPrincipal();
  const [settings, purchaseCalendar] = await Promise.all([
    readPricingSettings(principal),
    readPurchaseCalendarForManagement(principal),
  ]);
  return <main className="manager-page manager-settings-page"><div className="manager-breadcrumb">Gestor <span>›</span> Configurações</div><header className="manager-heading"><div><h1>Configurações - FLV</h1><p>Defina os parâmetros globais de precificação e do calendário operacional de compras.</p></div></header><div className="manager-settings-sections"><section className="manager-panel"><h2>Precificação</h2><p className="manager-section-description">Percentuais globais utilizados quando o produto não possui margem específica.</p><PricingSettingsForm initial={settings} /></section><section className="manager-panel"><h2>Calendário de compras</h2><p className="manager-section-description">Configure o corte e os dias semanais habilitados para novos ciclos.</p><PurchaseCalendarForm initial={purchaseCalendar} /></section></div></main>;
}
