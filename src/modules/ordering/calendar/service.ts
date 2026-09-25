import type { Principal } from "@/modules/identity";
import {
  authorizePurchaseCalendarManagement,
  calculatePurchaseCycle,
  validatePurchaseCalendar,
  validatePurchaseCalendarVersion,
} from "./domain";
import {
  readOperationalPurchaseCalendar,
  readPurchaseCalendarForManagement,
  updatePurchaseCalendar,
} from "./repository";

export { readOperationalPurchaseCalendar, readPurchaseCalendarForManagement };

export async function currentPurchaseCycle(now = new Date()) {
  return calculatePurchaseCycle(now, await readOperationalPurchaseCalendar());
}

export async function savePurchaseCalendar(
  principal: Principal,
  input: {
    timezone: string;
    cutoffTime: string;
    enabledIsoWeekdays: readonly number[];
    expectedVersion: number;
  },
) {
  authorizePurchaseCalendarManagement(principal);
  return updatePurchaseCalendar(principal, {
    ...validatePurchaseCalendar(input),
    expectedVersion: validatePurchaseCalendarVersion(input.expectedVersion),
  });
}
