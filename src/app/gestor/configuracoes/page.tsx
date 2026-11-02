import { requirePermission } from "@/modules/identity/session";
import { PurchaseCalendarForm } from "@/modules/ordering/calendar/calendar-form";
import { readPurchaseCalendarForManagement } from "@/modules/ordering/calendar/service";
import { PricingSettingsForm } from "@/modules/pricing/parameters/settings-form";
import { readPricingSettings } from "@/modules/pricing/parameters/service";
import { CycleArchivePanel } from "@/modules/purchasing/cycle-archive/cycle-archive-panel";
import { listCyclesPendingClosure } from "@/modules/purchasing/cycle-archive/repository";

export const dynamic = "force-dynamic";

export default async function PricingSettingsPage() {
  const principal = await requirePermission("gestor:configuracoes");
  const [settings, purchaseCalendar, pendingCycles] = await Promise.all([
    readPricingSettings(principal),
    readPurchaseCalendarForManagement(principal),
    listCyclesPendingClosure(),
  ]);
  return <main className="manager-page manager-settings-page"><div className="manager-breadcrumb">Gestor <span>›</span> Configurações</div><header className="manager-heading"><div><h1>Configurações - FLV</h1><p>Defina os parâmetros globais de precificação e do calendário operacional de compras.</p></div></header><div className="manager-settings-sections"><section className="manager-panel"><h2>Precificação</h2><p className="manager-section-description">Percentuais globais utilizados quando o produto não possui margem específica.</p><PricingSettingsForm initial={settings} /></section><section className="manager-panel"><h2>Calendário de compras</h2><p className="manager-section-description">Configure o corte e os dias semanais habilitados para novos ciclos.</p><PurchaseCalendarForm initial={purchaseCalendar} /></section><section className="manager-panel"><h2>Ciclos antigos em aberto</h2><p className="manager-section-description">Ciclos anteriores a hoje com Destinação aberta ou conferência pendente. Encerre os que não serão mais trabalhados para que deixem de aparecer na Destinação e na Conferência das lojas.</p><CycleArchivePanel cycles={pendingCycles.cycles} /></section></div></main>;
}
