import { redirect } from "next/navigation";
import { hasPermission } from "@/modules/identity";
import { requirePrincipal } from "@/modules/identity/session";
import { OperationalShell } from "@/modules/navigation/operational-shell";

export default async function ReconciliationLayout({ children }: { children: React.ReactNode }) {
  const principal = await requirePrincipal();
  if (!hasPermission(principal, "fechamento:consultar")) redirect("/sem-acesso");
  return <OperationalShell role={principal.role} permissions={principal.permissions}>{children}</OperationalShell>;
}
