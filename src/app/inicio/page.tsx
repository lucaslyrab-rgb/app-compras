import { redirect } from "next/navigation";
import { StoreNavigation } from "@/components/store-navigation";
import { hasPermission, resolveOperationalRoute } from "@/modules/identity/domain";
import { requirePrincipal } from "@/modules/identity/session";
import { getStoreName } from "@/modules/ordering/repository";

export const dynamic = "force-dynamic";

export default async function StartPage() {
  const principal = await requirePrincipal();
  const hasOrderPermission = hasPermission(principal, "pedidos:criar");
  const hasConferencePermission = hasPermission(principal, "loja:conferencia");
  const hasLossPermission = hasPermission(principal, "loja:perdas");

  if (!principal.storeId || !(hasOrderPermission || hasConferencePermission || hasLossPermission)) {
    redirect(resolveOperationalRoute(principal) ?? "/sem-acesso");
  }

  const storeName = await getStoreName(principal.storeId);

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
      <StoreNavigation
        storeName={storeName}
        hasOrderPermission={hasOrderPermission}
        hasConferencePermission={hasConferencePermission}
        hasLossPermission={hasLossPermission}
        showHubOnMount
      />
      <main style={{ maxWidth: 800, margin: "32px auto", padding: "0 16px" }}>
        <h2 style={{ color: "#004737", marginBottom: 8 }}>O que você deseja fazer?</h2>
        <p>Escolha Pedido, Conferência ou Perdas entre as atividades disponíveis para sua loja.</p>
        <p>Você pode abrir novamente a escolha pelo botão “Módulos”.</p>
      </main>
    </div>
  );
}
