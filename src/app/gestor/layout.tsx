import { requireManagerPrincipal } from "@/modules/identity/session";
import { OperationalShell } from "@/modules/navigation/operational-shell";
import "./styles.css";

export default async function ManagerLayout({ children }: { children: React.ReactNode }) {
  const principal = await requireManagerPrincipal();
  return <OperationalShell role={principal.role}>{children}</OperationalShell>;
}
