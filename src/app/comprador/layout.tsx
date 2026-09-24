import { redirect } from "next/navigation";
import { requirePrincipal } from "@/modules/identity/session";
import { canViewConsolidated } from "@/modules/purchasing/domain";
import { OperationalShell } from "@/modules/navigation/operational-shell";

export default async function BuyerLayout({ children }: { children: React.ReactNode }) {
  const principal = await requirePrincipal();
  if (!canViewConsolidated(principal)) redirect("/");
  return <OperationalShell role={principal.role}>{children}</OperationalShell>;
}
