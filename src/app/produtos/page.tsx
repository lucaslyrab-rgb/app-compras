import { redirect } from "next/navigation";
import { requireManagerPrincipal } from "@/modules/identity/session";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  await requireManagerPrincipal();
  redirect("/gestor/produtos");
}
