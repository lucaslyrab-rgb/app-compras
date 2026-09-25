import { afterAll, describe, expect, it } from "vitest";
import { database } from "@/db/client";
import type { Principal } from "@/modules/identity";
import {
  readPurchaseCalendarForManagement,
  savePurchaseCalendar,
} from "@/modules/ordering/calendar/service";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("calendário operacional no PostgreSQL", () => {
  const manager: Principal = { userId: "00000000-0000-0000-0000-000000000001", role: "GESTOR", storeId: null };
  const buyer: Principal = { userId: "00000000-0000-0000-0000-000000000002", role: "COMPRADOR", storeId: null };
  const store: Principal = { userId: "00000000-0000-0000-0000-000000000003", role: "LOJA", storeId: "00000000-0000-0000-0000-000000000004" };

  afterAll(async () => { await database().sql.end(); });

  it("lê, atualiza com concorrência otimista e restringe gestão ao GESTOR", async () => {
    const initial = await readPurchaseCalendarForManagement(manager);
    expect(initial).toMatchObject({
      timezone: "America/Sao_Paulo",
      cutoffTime: "19:00",
      enabledIsoWeekdays: [1, 2, 4, 5],
    });
    await expect(readPurchaseCalendarForManagement(buyer)).rejects.toThrow(/Gestor/);
    await expect(readPurchaseCalendarForManagement(store)).rejects.toThrow(/Gestor/);
    await expect(savePurchaseCalendar(buyer, {
      timezone: initial.timezone,
      cutoffTime: initial.cutoffTime,
      enabledIsoWeekdays: initial.enabledIsoWeekdays,
      expectedVersion: initial.version,
    })).rejects.toThrow(/Gestor/);

    const saved = await savePurchaseCalendar(manager, {
      timezone: initial.timezone,
      cutoffTime: initial.cutoffTime,
      enabledIsoWeekdays: [5, 1, 4, 2, 5],
      expectedVersion: initial.version,
    });
    expect(saved).toMatchObject({
      timezone: "America/Sao_Paulo",
      cutoffTime: "19:00",
      enabledIsoWeekdays: [1, 2, 4, 5],
      version: initial.version + 1,
    });
    await expect(savePurchaseCalendar(manager, {
      timezone: initial.timezone,
      cutoffTime: "18:00",
      enabledIsoWeekdays: initial.enabledIsoWeekdays,
      expectedVersion: initial.version,
    })).rejects.toThrow(/outra sessão/);
    await expect(savePurchaseCalendar(manager, {
      timezone: initial.timezone,
      cutoffTime: initial.cutoffTime,
      enabledIsoWeekdays: [],
      expectedVersion: saved.version,
    })).rejects.toThrow(/pelo menos um dia/);
  });
});
