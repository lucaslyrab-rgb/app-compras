import { redirect } from "next/navigation";
import Link from "next/link";
import { requirePrincipal } from "@/modules/identity/session";
import { hasPermission } from "@/modules/identity/domain";
import { currentPurchaseCycle } from "@/modules/ordering/calendar/service";
import { getStoreName } from "@/modules/ordering/repository";
import { getStoreConference } from "@/modules/purchasing/conferences/repository";
import { ConferenceWorkspace } from "@/modules/purchasing/conferences/conference-workspace";
import { StoreNavigation } from "@/components/store-navigation";

export const dynamic = "force-dynamic";

export default async function ConferencePage() {
  const principal = await requirePrincipal();

  if (!hasPermission(principal, "loja:conferencia") || !principal.storeId) {
    redirect("/sem-acesso");
  }

  const storeName = await getStoreName(principal.storeId);
  const cycle = await currentPurchaseCycle();
  const conferenceData = await getStoreConference(principal.storeId, cycle.cycleDate);

  if (!conferenceData) {
    return (
      <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
        <StoreNavigation storeName={storeName} />
        <main style={{ maxWidth: 800, margin: "40px auto", padding: "0 16px", textAlign: "center" }}>
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
                {new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date(`${cycle.cycleDate}T12:00:00`))}
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
    <ConferenceWorkspace
      header={conferenceData.header}
      initialItems={conferenceData.items}
    />
  );
}
