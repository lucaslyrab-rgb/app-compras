import { describe, expect, it } from "vitest";
import {
  CycleArchiveError,
  canArchiveCycle,
  describeStoreSituation,
  isCycleStillOpen,
  parseArchiveReason,
  type OpenCycleSummary,
} from "@/modules/purchasing/cycle-archive/domain";

const store = (partial: Partial<OpenCycleSummary["stores"][number]> = {}) => ({
  storeId: "s1",
  storeName: "MultiShow Ponta da Fruta",
  hasOrder: true,
  conference: "FINALIZED" as const,
  verifiedItems: 0,
  totalItems: 0,
  ...partial,
});

describe("encerrar ciclo pelo Gestor", () => {
  it("considera aberto o ciclo com Destinação aberta ou loja com pedido sem conferência encerrada", () => {
    expect(isCycleStillOpen({ cycleDate: "2026-10-20", buyerStatus: "OPEN", stores: [store()] })).toBe(true);
    expect(isCycleStillOpen({ cycleDate: "2026-10-20", buyerStatus: "CLOSED", stores: [store({ conference: "IN_PROGRESS" })] })).toBe(true);
    expect(isCycleStillOpen({ cycleDate: "2026-10-20", buyerStatus: "CLOSED", stores: [store({ conference: "NOT_STARTED" })] })).toBe(true);
    expect(
      isCycleStillOpen({ cycleDate: "2026-10-20", buyerStatus: "CLOSED", stores: [store({ hasOrder: false, conference: "NOT_STARTED" })] }),
    ).toBe(false);
    expect(
      isCycleStillOpen({ cycleDate: "2026-10-20", buyerStatus: "CLOSED", stores: [store(), store({ conference: "CANCELLED" })] }),
    ).toBe(false);
  });

  it("só permite encerrar ciclos anteriores a hoje", () => {
    expect(canArchiveCycle("2026-10-31", "2026-11-02")).toBe(true);
    expect(canArchiveCycle("2026-11-02", "2026-11-02")).toBe(false);
    expect(canArchiveCycle("2026-11-03", "2026-11-02")).toBe(false);
  });

  it("exige motivo de 3 a 300 caracteres", () => {
    expect(parseArchiveReason("  ciclo de teste  ")).toBe("ciclo de teste");
    expect(() => parseArchiveReason("ok")).toThrow(CycleArchiveError);
    expect(() => parseArchiveReason(undefined)).toThrow(CycleArchiveError);
    expect(() => parseArchiveReason("x".repeat(301))).toThrow(CycleArchiveError);
  });

  it("descreve a situação de cada loja antes da confirmação", () => {
    expect(describeStoreSituation(store({ conference: "IN_PROGRESS", verifiedItems: 12, totalItems: 30 }))).toBe(
      "conferência em andamento (12 de 30 itens)",
    );
    expect(describeStoreSituation(store({ conference: "NOT_STARTED" }))).toBe("conferência não iniciada");
    expect(describeStoreSituation(store({ hasOrder: false, conference: "NOT_STARTED" }))).toBe("sem pedido");
    expect(describeStoreSituation(store())).toBe("conferência finalizada");
  });
});
