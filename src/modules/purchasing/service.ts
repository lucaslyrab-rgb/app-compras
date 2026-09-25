import type { Principal } from "@/modules/identity";
import { currentPurchaseCycle } from "@/modules/ordering/calendar/service";
import { readConsolidated } from "./repository";

// Cross-module orchestration stays outside repositories. The existing backend
// calendar is used only when no persisted cycle exists; it is never reimplemented.
export async function loadConsolidated(
  principal: Principal,
  requestedCycle?: string,
) {
  return readConsolidated(principal, requestedCycle, (await currentPurchaseCycle()).cycleDate);
}
