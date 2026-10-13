import { requirePermission } from "@/modules/identity/session";
import { listSuppliers, SupplierWorkspace } from "@/modules/suppliers";

export const dynamic = "force-dynamic";

export default async function BuyerSuppliersPage() {
  const principal = await requirePermission("compras:fornecedores");
  const suppliers = await listSuppliers();

  return (
    <SupplierWorkspace
      initialSuppliers={suppliers}
      role={principal.role}
      canToggleStatus={false}
    />
  );
}
