import { notFound } from "next/navigation";
import { requirePermission } from "@/modules/identity/session";
import { loadSupplierBillingReport } from "@/modules/purchasing/reports/supplier-billing/repository";
import { SupplierBillingView } from "@/modules/purchasing/reports/supplier-billing/supplier-billing-view";

export const dynamic = "force-dynamic";

export default async function ManagerSupplierBillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ciclo?: string }>;
}) {
  await requirePermission("gestor:fornecedores");
  const { id } = await params;
  const { ciclo } = await searchParams;

  let report;
  try {
    report = await loadSupplierBillingReport(id, ciclo);
  } catch {
    notFound();
  }

  return (
    <SupplierBillingView
      report={report}
      backHref="/gestor/fornecedores"
    />
  );
}
