import { redirect } from "next/navigation";
import { requirePrincipal } from "@/modules/identity/session";
import { hasAnyPermission } from "@/modules/identity";
import { OperationalShell } from "@/modules/navigation/operational-shell";

export default async function BuyerLayout({ children }: { children: React.ReactNode }) {
  const principal = await requirePrincipal();
  if (!hasAnyPermission(principal, ["compras:consolidado", "compras:custos"])) redirect("/");
  return <OperationalShell role={principal.role} permissions={principal.permissions}>{children}</OperationalShell>;
}
