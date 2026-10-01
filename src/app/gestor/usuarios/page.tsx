import { requirePermission } from "@/modules/identity/session";
import { listUsersForManagement, listActiveStores } from "@/modules/identity/repository";
import { UserWorkspace } from "@/modules/identity/user-workspace";

export const dynamic = "force-dynamic";

export default async function ManagerUsersPage() {
  const principal = await requirePermission("gestor:usuarios");
  const [users, stores] = await Promise.all([
    listUsersForManagement(),
    listActiveStores(),
  ]);

  return (
    <UserWorkspace
      initialUsers={users}
      stores={stores}
      currentUserId={principal.userId}
    />
  );
}
