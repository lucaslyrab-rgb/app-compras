import { describe, expect, it } from "vitest";
import {
  buildProductJourneys,
  buildStoreValues,
  countInvoices,
  filterJourneys,
  neighborCycles,
  receivedRatio,
  resolveClosingFilters,
  resolveCycle,
  summarizeJourneys,
} from "@/modules/purchasing/reconciliation/closing";
import { buildReconciliationLines, type ReconciliationSources, type SourceAllocation } from "@/modules/purchasing/reconciliation/domain";

const C = "2026-11-04";
const NF4521 = { storeId: "s1", supplierId: "supA", number: "4521", invoiceId: "inv1", entryConfirmedAt: "13/11 às 10:42", entryConfirmedBy: "CPD" };
const NF889 = { storeId: "s1", supplierId: "supB", number: "889", invoiceId: "inv2", entryConfirmedAt: null, entryConfirmedBy: null };
const NF77 = { storeId: "s2", supplierId: "supA", number: "77", invoiceId: null, entryConfirmedAt: null, entryConfirmedBy: null };
const S1 = "s1";
const S2 = "s2";

function alloc(storeId: string, productId: string, supplierId: string, qty: number, format: string, factor: number | null): SourceAllocation {
  return {
    cycleDate: C,
    storeId,
    productId,
    supplierId,
    supplierName: supplierId === "supA" ? "Frutas do Vale" : "Bom Preço",
    destinedQuantity: qty,
    purchaseFormat: format,
    isAdditionalPurchase: false,
    conversionFactorKg: factor,
  };
}

function sources(): ReconciliationSources {
  return {
    stores: [
      { id: S1, name: "Ponta da Fruta" },
      { id: S2, name: "Balneário" },
    ],
    products: [
      { id: "laranja", erpCode: 1, name: "LARANJA PERA", purchaseFormat: "CX", saleUnit: "KG", conversionQuantity: 20 },
      { id: "tomate", erpCode: 2, name: "TOMATE", purchaseFormat: "CX", saleUnit: "KG", conversionQuantity: 20 },
      { id: "aipim", erpCode: 3, name: "AIPIM", purchaseFormat: "KG", saleUnit: "KG", conversionQuantity: 1 },
      { id: "mamao", erpCode: 4, name: "MAMAO", purchaseFormat: "CX", saleUnit: "KG", conversionQuantity: 20 },
      { id: "abacaxi", erpCode: 5, name: "ABACAXI", purchaseFormat: "UND", saleUnit: "UND", conversionQuantity: 1 },
      { id: "uva", erpCode: 6, name: "UVA", purchaseFormat: "CX", saleUnit: "KG", conversionQuantity: 8 },
      { id: "banana", erpCode: 7, name: "BANANA", purchaseFormat: "CX", saleUnit: "KG", conversionQuantity: 20 },
      { id: "couve", erpCode: 8, name: "COUVE", purchaseFormat: "CX", saleUnit: "UND", conversionQuantity: 12 },
    ],
    referenceOrders: [
      { cycleDate: C, storeId: S1, orderId: "o1", revision: 1, source: "CLOSURE" },
      { cycleDate: C, storeId: S2, orderId: "o2", revision: 1, source: "CLOSURE" },
    ],
    orderItems: [
      { cycleDate: C, storeId: S1, productId: "laranja", quantity: 6 },
      { cycleDate: C, storeId: S2, productId: "laranja", quantity: 4 },
      { cycleDate: C, storeId: S1, productId: "tomate", quantity: 5 },
      { cycleDate: C, storeId: S2, productId: "aipim", quantity: 40 },
      { cycleDate: C, storeId: S1, productId: "mamao", quantity: 5 },
      { cycleDate: C, storeId: S1, productId: "abacaxi", quantity: 10 },
    ],
    allocations: [
      alloc(S1, "laranja", "supA", 6, "CX", 20),
      alloc(S2, "laranja", "supA", 3, "CX", 20),
      alloc(S1, "mamao", "supB", 5, "CX", 20),
      alloc(S1, "abacaxi", "supB", 10, "UND", null),
      alloc(S2, "uva", "supA", 2, "CX", 8),
      alloc(S2, "couve", "supB", 1, "CX", null),
    ],
    notPurchased: [],
    conferences: [
      { cycleDate: C, storeId: S1, status: "FINALIZED", orderRevision: 1, totalItems: 4, verifiedItems: 4 },
      { cycleDate: C, storeId: S2, status: "IN_PROGRESS", orderRevision: 1, totalItems: 3, verifiedItems: 1 },
    ],
    conferenceItems: [
      { cycleDate: C, storeId: S1, productId: "laranja", receivedWeightKg: 118.2, isUnreceived: false, removedFromOrder: false },
      { cycleDate: C, storeId: S1, productId: "mamao", receivedWeightKg: 101, isUnreceived: false, removedFromOrder: false },
      { cycleDate: C, storeId: S1, productId: "abacaxi", receivedWeightKg: null, isUnreceived: false, removedFromOrder: false },
      { cycleDate: C, storeId: S1, productId: "tomate", receivedWeightKg: 0, isUnreceived: true, removedFromOrder: false },
      { cycleDate: C, storeId: S2, productId: "laranja", receivedWeightKg: 57.9, isUnreceived: false, removedFromOrder: false },
    ],
    losses: [],
    costs: [
      { cycleDate: C, productId: "laranja", cost: 62, purchased: true, updatedByName: "Christian" },
      { cycleDate: C, productId: "aipim", cost: 3.2, purchased: true, updatedByName: "Christian" },
      { cycleDate: C, productId: "mamao", cost: 55, purchased: true, updatedByName: "Christian" },
      { cycleDate: C, productId: "abacaxi", cost: 4, purchased: true, updatedByName: "Christian" },
      { cycleDate: C, productId: "uva", cost: 95, purchased: true, updatedByName: "Christian" },
      { cycleDate: C, productId: "banana", cost: 48, purchased: true, updatedByName: "Christian" },
      { cycleDate: C, productId: "tomate", cost: null, purchased: false, updatedByName: null },
    ],
    invoices: [
      { cycleDate: C, storeId: S1, supplierId: "supA", invoiceNumber: "4521", invoiceId: "inv1", entryConfirmedAt: "13/11 às 10:42", entryConfirmedByName: "CPD" },
      { cycleDate: C, storeId: S1, supplierId: "supB", invoiceNumber: "889", invoiceId: "inv2" },
      { cycleDate: C, storeId: S2, supplierId: "supA", invoiceNumber: "77", invoiceId: null, informed: true },
    ],
  };
}

describe("caminho dos produtos no ciclo", () => {
  const src = sources();
  const lines = buildReconciliationLines(src);
  const journeys = buildProductJourneys(src, lines, { cycleDate: C });
  const byId = new Map(journeys.map((j) => [j.productId, j]));

  it("ordena pelos problemas mais graves e depois pelo nome", () => {
    expect(journeys.map((j) => j.productId)).toEqual([
      "tomate", "aipim", "banana", "couve", "uva", "laranja", "abacaxi", "mamao",
    ]);
  });

  it("pedido e não comprado; comprado sem destinação (com e sem pedido)", () => {
    expect(byId.get("tomate")!.issues).toEqual(["NOT_PURCHASED"]);
    expect(byId.get("tomate")!.purchase).toEqual({ purchased: false, cost: null, by: null });
    expect(byId.get("aipim")!.issues).toEqual(["PURCHASED_NOT_DESTINED"]);
    expect(byId.get("banana")!).toMatchObject({ issues: ["PURCHASED_NOT_DESTINED"], order: null, lines: [] });
  });

  it("soma pedido, destino, corte e pesagem de todas as lojas", () => {
    const laranja = byId.get("laranja")!;
    expect(laranja.order).toEqual({ groups: [{ unit: "CX", quantity: 10 }], stores: 2 });
    expect(laranja.unit).toBe("CX");
    expect(laranja.purchase).toEqual({ purchased: true, cost: 62, by: "Christian" });
    expect(laranja.destination?.groups).toEqual([{ unit: "CX", quantity: 9 }]);
    expect(laranja.destination?.suppliers).toEqual([
      expect.objectContaining({ supplierName: "Frutas do Vale", quantity: 9, invoices: [NF4521, NF77], stores: [
        { storeId: S2, storeName: "Balneário", quantity: 3 },
        { storeId: S1, storeName: "Ponta da Fruta", quantity: 6 },
      ] }),
    ]);
    expect(laranja.cut).toEqual({ difference: -1, unit: "CX", stores: 1 });
    expect(laranja.conference).toEqual({
      storesWithDestination: 2, storesFinalized: 1, expectedKg: 180, receivedKg: 176.1, percent: -2.2, notReceived: 0,
    });
    expect(laranja.issues).toEqual(["CUT", "CONFERENCE_PENDING"]);
  });

  it("adicional fora da conferência pede atenção; produto por unidade conferido fica certo", () => {
    expect(byId.get("uva")!.issues).toEqual(["CONFERENCE_DIFFERENCE", "ADDITIONAL", "CONFERENCE_PENDING"]);
    expect(byId.get("uva")!.additional).toEqual({ difference: 2, unit: "CX", stores: 1 });
    expect(byId.get("abacaxi")!.issues).toEqual([]);
    expect(byId.get("mamao")!.issues).toEqual([]);
  });

  it("resume o ciclo e filtra por desfecho e busca", () => {
    const summary = summarizeJourneys(journeys);
    expect(summary.total).toBe(8);
    expect(summary.counts).toEqual({
      NOT_PURCHASED: 1, PURCHASED_NOT_DESTINED: 2, CUT: 1, CONFERENCE_DIFFERENCE: 2, CONFERENCE_PENDING: 3, OK: 2, INVOICE_PENDING: 4,
    });
    expect(summary.ordered).toMatchObject({ products: 5, stores: 2 });
    expect(summary.purchased).toEqual({ products: 6, notPurchased: 1 });
    expect(summary.destined).toEqual({ products: 5, purchasedNotDestined: 2 });
    expect(summary.conference).toEqual({ storesWithDestination: 2, storesFinalized: 1, withDifference: 2, pending: 3 });

    expect(filterJourneys(journeys, { filter: "OK" }).map((j) => j.productId)).toEqual(["abacaxi", "mamao"]);
    expect(filterJourneys(journeys, { search: "mamão" }).map((j) => j.productId)).toEqual(["mamao"]);
    expect(filterJourneys(journeys, { search: "7" }).map((j) => j.productId)).toEqual(["banana"]);
  });

  it("com filtro de loja mostra só a loja, sem perder o que vale para o ciclo", () => {
    const ponta = buildProductJourneys(src, lines, { cycleDate: C, storeId: S1 });
    expect(ponta.map((j) => j.productId)).toEqual(["tomate", "abacaxi", "laranja", "mamao"]);
    expect(ponta.find((j) => j.productId === "laranja")!.issues).toEqual([]);
  });
});

describe("notas no caminho dos produtos", () => {
  const src = sources();
  const lines = buildReconciliationLines(src);
  const journeys = buildProductJourneys(src, lines, { cycleDate: C });
  const byId = new Map(journeys.map((j) => [j.productId, j]));

  it("mostra por loja os fornecedores do produto e suas notas, inclusive sem nota", () => {
    expect(byId.get("laranja")!.storeInvoices).toEqual({
      s1: [{ supplierId: "supA", supplierName: "Frutas do Vale", invoices: [NF4521] }],
      s2: [{ supplierId: "supA", supplierName: "Frutas do Vale", invoices: [NF77] }],
    });
    expect(byId.get("couve")!.storeInvoices).toEqual({ s2: [{ supplierId: "supB", supplierName: "Bom Preço", invoices: [] }] });
    expect(byId.get("tomate")!.storeInvoices).toEqual({});
  });

  it("marca o produto com nota sem entrada dada e conta as notas do ciclo", () => {
    expect(byId.get("laranja")!.hasPendingInvoice).toBe(true); // NF 77 sem entrada
    expect(byId.get("mamao")!.hasPendingInvoice).toBe(true); // NF 889 sem entrada
    expect(byId.get("couve")!.hasPendingInvoice).toBe(false); // sem nota nenhuma
    expect(filterJourneys(journeys, { filter: "INVOICE_PENDING" }).map((j) => j.productId)).toEqual(["uva", "laranja", "abacaxi", "mamao"]);
    expect(countInvoices(src, C)).toEqual({ total: 3, pending: 2 });
    expect(countInvoices(src, C, "s1")).toEqual({ total: 2, pending: 1 });
    expect(summarizeJourneys(journeys, countInvoices(src, C)).invoices).toEqual({ total: 3, pending: 2 });
  });
});

describe("valor por loja", () => {
  const src = sources();
  const lines = buildReconciliationLines(src);
  const result = buildStoreValues(src, lines, C);
  const [balneario, ponta] = result.stores;

  it("calcula comprado × custo e recebido pelo peso só com conferência finalizada", () => {
    expect(ponta).toMatchObject({
      storeName: "Ponta da Fruta",
      products: 3,
      purchasedValue: 687,
      receivedValue: 684.17,
      difference: -2.83,
      differencePercent: -0.4,
      share: 64.6,
      conference: { state: "FINALIZED", totalItems: 4, verifiedItems: 4 },
      missingCost: 0,
    });
    expect(ponta.suppliers).toEqual([
      { supplierId: "supA", supplierName: "Frutas do Vale", invoices: [NF4521], products: 1, purchasedValue: 372, receivedValue: 366.42, difference: -5.58 },
      { supplierId: "supB", supplierName: "Bom Preço", invoices: [NF889], products: 2, purchasedValue: 315, receivedValue: 317.75, difference: 2.75 },
    ]);
    expect(balneario).toMatchObject({
      storeName: "Balneário",
      products: 3,
      purchasedValue: 376,
      receivedValue: null,
      difference: null,
      share: 35.4,
      missingCost: 1,
      conference: { state: "IN_PROGRESS", totalItems: 3, verifiedItems: 1 },
    });
  });

  it("soma o ciclo comparando só as lojas conferidas", () => {
    expect(result.totals).toEqual({
      purchasedValue: 1063,
      products: 5,
      suppliers: 2,
      storesFinalized: 1,
      receivedValue: 684.17,
      purchasedOfFinalized: 687,
      difference: -2.83,
      differencePercent: -0.4,
      missingCost: 1,
    });
  });

  it("não recebido vale zero; sem pesagem vale o comprado", () => {
    const line = lines.find((l) => l.productId === "abacaxi")!;
    expect(receivedRatio(line)).toBe(1);
    expect(receivedRatio({ ...line, conference: { ...line.conference, item: { ...line.conference.item!, isUnreceived: true } } })).toBe(0);
    expect(receivedRatio(undefined)).toBe(1);
  });
});

describe("ciclo escolhido", () => {
  const cycles = ["2026-11-12", "2026-11-05", "2026-11-04", "2026-10-30"];

  it("usa o ciclo da URL ou o mais recente até hoje", () => {
    expect(resolveCycle("2026-11-04", cycles, "2026-11-10")).toBe("2026-11-04");
    expect(resolveCycle(undefined, cycles, "2026-11-10")).toBe("2026-11-05");
    expect(resolveCycle("x", cycles, "2026-10-01")).toBe("2026-10-30");
    expect(resolveCycle(undefined, [], "2026-11-10")).toBeNull();
  });

  it("acha ciclo anterior e próximo", () => {
    expect(neighborCycles(cycles, "2026-11-05")).toEqual({ previousCycle: "2026-11-04", nextCycle: "2026-11-12" });
    expect(neighborCycles(cycles, "2026-10-30")).toEqual({ previousCycle: null, nextCycle: "2026-11-04" });
  });

  it("lê aba, loja, busca e desfecho da URL", () => {
    expect(resolveClosingFilters({ aba: "valores", loja: " s1 ", desfecho: "CUT", busca: " uva " }, cycles, "2026-11-10")).toEqual({
      cycleDate: "2026-11-05", tab: "valores", storeId: "s1", search: "uva", filter: "CUT",
    });
    expect(resolveClosingFilters({ desfecho: "QUALQUER" }, cycles, "2026-11-10")).toMatchObject({ tab: "produtos", filter: undefined });
  });
});
