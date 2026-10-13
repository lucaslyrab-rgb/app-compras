import { requirePermission } from "@/modules/identity/session";
import { listSuppliers, SupplierWorkspace } from "@/modules/suppliers";

export const dynamic = "force-dynamic";

export default async function ManagerSuppliersPage() {
  const principal = await requirePermission("gestor:fornecedores");
  const suppliers = await listSuppliers();

  return (
    <SupplierWorkspace
      initialSuppliers={suppliers}
      role={principal.role}
      canToggleStatus={true}
    />
  );
}
