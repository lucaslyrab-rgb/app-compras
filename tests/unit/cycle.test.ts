import { describe, expect, it } from "vitest";
import {
  authorizePurchaseCalendarManagement,
  calculatePurchaseCycle,
  validatePurchaseCalendar,
  validatePurchaseCalendarVersion,
} from "@/modules/ordering/calendar/domain";

const multishowCalendar: Parameters<typeof calculatePurchaseCycle>[1] = {
  timezone: "America/Sao_Paulo",
  cutoffTime: "19:00",
  enabledIsoWeekdays: [1, 2, 4, 5],
};

function atSaoPaulo(localDateTime: string) {
  return new Date(`${localDateTime}-03:00`);
}

describe("ciclo de compra", () => {
  it.each([
    ["segunda 18:59", "2026-09-21T18:59:00", "2026-09-22", false],
    ["segunda 19:00", "2026-09-21T19:00:00", "2026-09-24", true],
    ["terça 18:59", "2026-09-22T18:59:00", "2026-09-24", false],
    ["terça 19:00", "2026-09-22T19:00:00", "2026-09-25", true],
    ["quarta 18:59", "2026-09-23T18:59:00", "2026-09-24", false],
    ["quarta 19:00", "2026-09-23T19:00:00", "2026-09-25", true],
    ["quinta 18:59", "2026-09-24T18:59:00", "2026-09-25", false],
    ["quinta 19:00", "2026-09-24T19:00:00", "2026-09-28", true],
    ["sexta 18:59", "2026-09-25T18:59:00", "2026-09-28", false],
    ["sexta 19:00", "2026-09-25T19:00:00", "2026-09-29", true],
    ["sábado 18:59", "2026-09-26T18:59:00", "2026-09-28", false],
    ["sábado 19:00", "2026-09-26T19:00:00", "2026-09-29", true],
    ["domingo 18:59", "2026-09-27T18:59:00", "2026-09-28", false],
    ["domingo 19:00", "2026-09-27T19:00:00", "2026-09-29", true],
  ])("resolve %s", (_label, localDateTime, expectedDate, afterCutoff) => {
    const result = calculatePurchaseCycle(atSaoPaulo(localDateTime), multishowCalendar);

    expect(result.cycleDate).toBe(expectedDate);
    expect(result.afterCutoff).toBe(afterCutoff);
  });

  it("trata 18:59:59 antes e 19:00:00 exatamente no corte", () => {
    expect(calculatePurchaseCycle(atSaoPaulo("2026-09-21T18:59:59"), multishowCalendar)).toMatchObject({
      cycleDate: "2026-09-22",
      afterCutoff: false,
    });
    expect(calculatePurchaseCycle(atSaoPaulo("2026-09-21T19:00:00"), multishowCalendar)).toMatchObject({
      cycleDate: "2026-09-24",
      afterCutoff: true,
    });
  });

  it("calcula o instante de corte no timezone operacional", () => {
    expect(calculatePurchaseCycle(atSaoPaulo("2026-09-21T18:59:59"), multishowCalendar).cutoffAt.toISOString()).toBe(
      "2026-09-21T22:00:00.000Z",
    );
    expect(calculatePurchaseCycle(atSaoPaulo("2026-09-21T19:00:00"), multishowCalendar).cutoffAt.toISOString()).toBe(
      "2026-09-22T22:00:00.000Z",
    );
  });

  it("atravessa mudança de mês", () => {
    expect(calculatePurchaseCycle(atSaoPaulo("2026-09-30T18:59:59"), multishowCalendar).cycleDate).toBe("2026-10-01");
  });

  it("atravessa mudança de ano", () => {
    expect(calculatePurchaseCycle(atSaoPaulo("2026-12-31T19:00:00"), multishowCalendar).cycleDate).toBe("2027-01-04");
  });

  it("obedece a um calendário alternativo sem dias MultiShow hard-coded", () => {
    const alternative: Parameters<typeof calculatePurchaseCycle>[1] = {
      timezone: "UTC",
      cutoffTime: "08:30",
      enabledIsoWeekdays: [3],
    };

    expect(calculatePurchaseCycle(new Date("2026-09-22T08:29:59Z"), alternative).cycleDate).toBe("2026-09-23");
    expect(calculatePurchaseCycle(new Date("2026-09-22T08:30:00Z"), alternative).cycleDate).toBe("2026-09-30");
  });

  it("valida timezone, horário de corte e pelo menos um dia habilitado", () => {
    expect(validatePurchaseCalendar(multishowCalendar)).toEqual(multishowCalendar);
    expect(() => validatePurchaseCalendar({ ...multishowCalendar, timezone: "Invalid/Timezone" })).toThrow(
      "Informe um timezone válido",
    );
    expect(() => validatePurchaseCalendar({ ...multishowCalendar, cutoffTime: "24:00" })).toThrow(
      "Informe um horário de corte válido",
    );
    expect(() => validatePurchaseCalendar({ ...multishowCalendar, enabledIsoWeekdays: [] })).toThrow(
      "Habilite pelo menos um dia de compra",
    );
    expect(() => validatePurchaseCalendar({ ...multishowCalendar, enabledIsoWeekdays: [8] })).toThrow(
      "Os dias de compra são inválidos",
    );
    expect(validatePurchaseCalendar({ ...multishowCalendar, enabledIsoWeekdays: [5, 1, 5, 2] }).enabledIsoWeekdays).toEqual([1, 2, 5]);
    expect(validatePurchaseCalendarVersion(1)).toBe(1);
    expect(() => validatePurchaseCalendarVersion(0)).toThrow("Versão do calendário inválida");
  });

  it("autoriza a gestão somente para GESTOR", () => {
    expect(() => authorizePurchaseCalendarManagement({ userId: "gestor", role: "GESTOR", storeId: null })).not.toThrow();
    expect(() => authorizePurchaseCalendarManagement({ userId: "comprador", role: "COMPRADOR", storeId: null })).toThrow(/Gestor/);
    expect(() => authorizePurchaseCalendarManagement({ userId: "loja", role: "LOJA", storeId: "loja" })).toThrow(/Gestor/);
  });
});
