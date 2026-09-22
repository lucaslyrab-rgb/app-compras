import type { Principal } from "@/modules/identity";
import { purchaseCycle } from "@/modules/ordering/repository";
import { readConsolidated } from "./repository";

// Cross-module orchestration stays outside repositories. The existing backend
// calendar is used only when no persisted cycle exists; it is never reimplemented.
export function loadConsolidated(
  principal: Principal,
  requestedCycle?: string,
) {
  return readConsolidated(principal, requestedCycle, purchaseCycle().cycleDate);
}
