import { database } from "@/db/client";
import type { Principal } from "@/modules/identity";
import {
  authorizePurchaseCalendarManagement,
  PurchaseCalendarConflictError,
  type IsoWeekday,
  type PurchaseCalendar,
} from "./domain";

type PurchaseCalendarRow = {
  timezone: string;
  cutoffTime: string;
  enabledIsoWeekdays: number[];
  version: number;
  updatedAt: string;
};

function fromRow(row: PurchaseCalendarRow): PurchaseCalendar {
  return {
    ...row,
    enabledIsoWeekdays: row.enabledIsoWeekdays as IsoWeekday[],
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export async function readOperationalPurchaseCalendar() {
  const [row] = await database().sql<PurchaseCalendarRow[]>`
    SELECT timezone, to_char(cutoff_time, 'HH24:MI') AS "cutoffTime",
           enabled_iso_weekdays AS "enabledIsoWeekdays",
           version, updated_at AS "updatedAt"
    FROM purchase_calendar_settings
    WHERE id = 'OPERATIONAL'
  `;
  if (!row) throw new Error("Calendário de compras não inicializado.");
  return fromRow(row);
}

export async function readPurchaseCalendarForManagement(principal: Principal) {
  authorizePurchaseCalendarManagement(principal);
  return readOperationalPurchaseCalendar();
}

export async function updatePurchaseCalendar(
  principal: Principal,
  input: {
    timezone: string;
    cutoffTime: string;
    enabledIsoWeekdays: IsoWeekday[];
    expectedVersion: number;
  },
) {
  authorizePurchaseCalendarManagement(principal);
  const rows = await database().sql<PurchaseCalendarRow[]>`
    UPDATE purchase_calendar_settings
    SET timezone = ${input.timezone},
        cutoff_time = ${input.cutoffTime}::time,
        enabled_iso_weekdays = ${input.enabledIsoWeekdays}::smallint[],
        version = version + 1,
        updated_at = now()
    WHERE id = 'OPERATIONAL' AND version = ${input.expectedVersion}
    RETURNING timezone, to_char(cutoff_time, 'HH24:MI') AS "cutoffTime",
              enabled_iso_weekdays AS "enabledIsoWeekdays",
              version, updated_at AS "updatedAt"
  `;
  if (rows[0]) return fromRow(rows[0]);
  throw new PurchaseCalendarConflictError(await readPurchaseCalendarForManagement(principal));
}
