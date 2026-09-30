import { redirect } from "next/navigation";
import { requirePermission } from "@/modules/identity/session";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  await requirePermission("gestor:produtos");
  redirect("/gestor/produtos");
}
