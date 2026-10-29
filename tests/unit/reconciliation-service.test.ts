import { beforeEach, describe, expect, it, vi } from "vitest";

const loadReconciliationSources = vi.fn();
vi.mock("@/modules/purchasing/reconciliation/repository", () => ({ loadReconciliationSources }));

const { getReconciliation, operationalToday, resolvePageSize } = await import(
  "@/modules/purchasing/reconciliation/service"
);

const CYCLE = "2026-10-27";
const STORE = "s1";

function sources() {
  return {
    stores: [{ id: STORE, name: "MultiShow Ponta da Fruta" }],
    products: [
      { id: "p1", erpCode: 1, name: "ABACATE KG", purchaseFormat: "CX", saleUnit: "KG", conversionQuantity: 20 },
      { id: "p2", erpCode: 2, name: "TOMATE KG", purchaseFormat: "CX", saleUnit: "KG", conversionQuantity: 20 },
    ],
    referenceOrders: [{ cycleDate: CYCLE, storeId: STORE, orderId: "o1", revision: 1, source: "LATEST" as const }],
    orderItems: [
      { cycleDate: CYCLE, storeId: STORE, productId: "p1", quantity: 3 },
      { cycleDate: CYCLE, storeId: STORE, productId: "p2", quantity: 2 },
    ],
    allocations: [
      {
        cycleDate: CYCLE, storeId: STORE, productId: "p1", supplierId: "sb", supplierName: "Beto",
        destinedQuantity: 3, purchaseFormat: "CX", isAdditionalPurchase: false, conversionFactorKg: 20,
      },
      {
        cycleDate: CYCLE, storeId: STORE, productId: "p2", supplierId: "sa", supplierName: "Ademar",
        destinedQuantity: 2, purchaseFormat: "CX", isAdditionalPurchase: false, conversionFactorKg: 20,
      },
    ],
    notPurchased: [],
    conferences: [{ cycleDate: CYCLE, storeId: STORE, status: "FINALIZED" as const, orderRevision: 1 }],
    conferenceItems: [
      { cycleDate: CYCLE, storeId: STORE, productId: "p1", receivedWeightKg: 50, isUnreceived: false, removedFromOrder: false },
      { cycleDate: CYCLE, storeId: STORE, productId: "p2", receivedWeightKg: 40.5, isUnreceived: false, removedFromOrder: false },
    ],
  };
}

describe("serviço do Fechamento integrado", () => {
  beforeEach(() => {
    loadReconciliationSources.mockReset();
    loadReconciliationSources.mockResolvedValue(sources());
  });

  it("usa a data do fuso de São Paulo", () => {
    expect(operationalToday(new Date("2026-10-30T02:30:00Z"))).toBe("2026-10-29");
    expect(operationalToday(new Date("2026-10-30T03:30:00Z"))).toBe("2026-10-30");
  });

  it("limita o tamanho da página", () => {
    expect(resolvePageSize(undefined)).toBe(50);
    expect(resolvePageSize("abc")).toBe(50);
    expect(resolvePageSize("100")).toBe(100);
    expect(resolvePageSize("999999")).toBe(1000);
  });

  it("lê o período e a loja, aplica filtros e calcula indicadores sobre todo o filtro", async () => {
    const result = await getReconciliation({ startDate: CYCLE, endDate: CYCLE, storeId: STORE }, "2026-10-29");
    expect(loadReconciliationSources).toHaveBeenCalledWith({ startDate: CYCLE, endDate: CYCLE, storeId: STORE });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines.map((l) => l.productId)).toEqual(["p1"]);
    expect(result.totalMatching).toBe(1);
    expect(result.kpis.weightOutOfRange).toBe(1);
    expect(result.kpis.weightOk).toBe(1);
    expect(result.suppliers).toEqual([
      { id: "sa", name: "Ademar" },
      { id: "sb", name: "Beto" },
    ]);
  });

  it("pagina sem alterar os indicadores", async () => {
    const result = await getReconciliation({ startDate: CYCLE, endDate: CYCLE, onlyAttention: "0", limit: "1" }, "2026-10-29");
    expect(result.ok && result.lines).toHaveLength(1);
    expect(result.ok && result.totalMatching).toBe(2);
    expect(result.ok && result.kpis.totalLines).toBe(2);
  });

  it("devolve erro amigável sem ler o banco quando o período é inválido", async () => {
    const result = await getReconciliation({ startDate: "2026-01-01", endDate: "2026-10-29" }, "2026-10-29");
    expect(result).toMatchObject({ ok: false, error: "O período máximo de consulta é de 31 dias." });
    expect(loadReconciliationSources).not.toHaveBeenCalled();
  });
});
