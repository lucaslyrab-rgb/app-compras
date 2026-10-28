import { redirect } from "next/navigation";
import Link from "next/link";
import { requirePrincipal } from "@/modules/identity/session";
import { hasPermission } from "@/modules/identity/domain";
import { isCycleDate } from "@/modules/purchasing/domain";
import { currentPurchaseCycle } from "@/modules/ordering/calendar/service";
import { getStoreName } from "@/modules/ordering/repository";
import { getStoreConference, listStoreConferenceCycles } from "@/modules/purchasing/conferences/repository";
import { ConferenceWorkspace } from "@/modules/purchasing/conferences/conference-workspace";
import { ConferenceCycleSelector } from "@/modules/purchasing/conferences/conference-cycle-selector";
import { StoreNavigation } from "@/components/store-navigation";

export const dynamic = "force-dynamic";

export default async function ConferencePage({
  searchParams,
}: {
  searchParams: Promise<{ ciclo?: string }>;
}) {
  const principal = await requirePrincipal();

  if (!hasPermission(principal, "loja:conferencia") || !principal.storeId) {
    redirect("/sem-acesso");
  }

  const { ciclo } = await searchParams;
  const storeName = await getStoreName(principal.storeId);

  // A conferência da entrega atual não é necessariamente a do ciclo de um NOVO
  // pedido (currentPurchaseCycle aponta para a compra futura). Lista os ciclos
  // recentes com pedido/conferência da loja e permite retomar qualquer um deles,
  // incluindo pendências anteriores, em vez de travar na data de hoje.
  const cycles = await listStoreConferenceCycles(principal.storeId);
  const requestedCycle = ciclo && isCycleDate(ciclo) ? ciclo : null;
  const pendingCycle = cycles.find((c) => c.status !== "FINALIZED")?.cycleDate;
  const latestCycle = cycles[cycles.length - 1]?.cycleDate;
  const fallbackCycle = (await currentPurchaseCycle()).cycleDate;
  const cycleDate = requestedCycle ?? pendingCycle ?? latestCycle ?? fallbackCycle;

  const conferenceData = await getStoreConference(principal.storeId, cycleDate);
  const cycleOptions = cycles.map((c) => c.cycleDate);
  const hasOrderPermission = hasPermission(principal, "pedidos:criar");
  const hasLossPermission = hasPermission(principal, "loja:perdas");

  if (!conferenceData) {
    return (
      <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
        <StoreNavigation
          storeName={storeName}
          hasOrderPermission={hasOrderPermission}
          hasConferencePermission
          hasLossPermission={hasLossPermission}
        />
        <main style={{ maxWidth: 800, margin: "40px auto", padding: "0 16px", textAlign: "center" }}>
          <ConferenceCycleSelector cycleDate={cycleDate} cycles={cycleOptions} />
          <div
            style={{
              background: "#ffffff",
              borderRadius: 12,
              padding: "40px 24px",
              border: "1px solid #cbd5e1",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            }}
          >
            <div style={{ fontSize: 48, marginBottom: 16 }}>🚚</div>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", margin: "0 0 8px" }}>
              Nenhum pedido aguardando conferência
            </h2>
            <p style={{ fontSize: 14, color: "#64748b", maxWidth: 480, margin: "0 auto 20px" }}>
              Não há pedido enviado pela sua loja para a compra de{" "}
              <strong>
                {new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date(`${cycleDate}T12:00:00`))}
              </strong>
              . A conferência é gerada automaticamente a partir do pedido confirmado da loja.
            </p>
            <Link href="/" className="btn" style={{ textDecoration: "none", display: "inline-block" }}>
              ← Ir para Pedidos da Loja
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    // key pela identidade da conferência: trocar de ciclo deve reiniciar todo o
    // estado do componente (itens, pesos em edição, versão, mensagens), nunca
    // reaproveitar o estado em memória de uma conferência diferente.
    <ConferenceWorkspace
      key={conferenceData.header.id}
      header={conferenceData.header}
      initialItems={conferenceData.items}
      cycles={cycleOptions}
      hasOrderPermission={hasOrderPermission}
      hasLossPermission={hasLossPermission}
    />
  );
}
