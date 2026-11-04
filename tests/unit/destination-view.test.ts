import { describe, expect, it } from "vitest";
import {
  closureItemTag,
  filterSuppliers,
  formatQty,
  isProductPending,
  productStoreStatus,
  sortSuppliersForPicker,
  splitClosureItems,
  storeProgress,
  suggestionLabel,
  supplierInitials,
} from "@/modules/purchasing/allocations/destination-view";
import type {
  StoreCutItem,
  StoreSummaryData,
  SupplierSummaryOption,
} from "@/modules/purchasing/allocations/domain";

function supplier(id: string, displayName: string, reviewedIn: string[] = []): SupplierSummaryOption {
  return {
    id,
    corporateName: `${displayName} Comercio LTDA`,
    tradeName: displayName,
    displayName,
    taxId: null,
    active: true,
    hasAllocationsInCycle: false,
    totalDestinedQuantity: "0.00",
    destinedByStore: {},
    reviewedByStore: Object.fromEntries(reviewedIn.map((storeId) => [storeId, true])),
  };
}

function summary(partial: Partial<StoreSummaryData>): StoreSummaryData {
  return {
    storeId: "pf",
    storeName: "MultiShow Ponta da Fruta",
    storeSlug: "ponta-da-fruta",
    totalAllocatedProducts: 0,
    totalDestinedQuantity: "0.00",
    totalOrderedProducts: 0,
    totalDestinedProducts: 0,
    totalPartialCutProducts: 0,
    totalUnallocatedProducts: 0,
    totalReviewedProducts: 0,
    totalPendingProducts: 0,
    closureStatus: "OPEN",
    isStale: false,
    ...partial,
  };
}

function cut(productName: string, status: StoreCutItem["status"], ordered: string, destined: string, cutQty = "0.00"): StoreCutItem {
  return {
    productId: productName,
    erpCode: 1,
    productName,
    purchaseFormat: "CX",
    orderedQuantity: ordered,
    destinedQuantity: destined,
    cutQuantity: cutQty,
    status,
  };
}

describe("formatQty", () => {
  it("remove casas decimais desnecessárias e usa vírgula", () => {
    expect(formatQty("5.00")).toBe("5");
    expect(formatQty("2.50")).toBe("2,5");
    expect(formatQty("1.25")).toBe("1,25");
    expect(formatQty("0")).toBe("0");
    expect(formatQty(null)).toBe("0");
  });
});

describe("productStoreStatus", () => {
  const base = { unit: "CX", blockedByCosts: false };

  it("classifica a destinar, integral, corte parcial e excedente", () => {
    expect(productStoreStatus({ ...base, store: { orderedQuantity: "8.00", destinedQuantity: "0.00" } })).toMatchObject({
      kind: "pending",
      label: "A destinar",
    });
    expect(productStoreStatus({ ...base, store: { orderedQuantity: "8.00", destinedQuantity: "8.00" } }).kind).toBe("integral");
    const partial = productStoreStatus({ ...base, store: { orderedQuantity: "3.00", destinedQuantity: "2.00" } });
    expect(partial).toMatchObject({ kind: "partial", label: "−1 CX", tone: "partial" });
    const surplus = productStoreStatus({ ...base, store: { orderedQuantity: "4.00", destinedQuantity: "5.00" } });
    expect(surplus).toMatchObject({ kind: "additional", label: "+1 CX" });
  });

  it("considera o que já foi destinado em outros fornecedores", () => {
    const store = { orderedQuantity: "6.00", destinedQuantity: "0.00" };
    expect(productStoreStatus({ ...base, store, destinedInOtherSuppliers: "4.00" })).toMatchObject({
      kind: "pending",
      label: "Falta 2 CX",
    });
    expect(productStoreStatus({ ...base, store, destinedInOtherSuppliers: "6.00" }).kind).toBe("elsewhere");
    expect(
      productStoreStatus({ ...base, store: { orderedQuantity: "6.00", destinedQuantity: "2.00" }, destinedInOtherSuppliers: "4.00" })
        .kind,
    ).toBe("integral");
  });

  it("trata produto sem pedido como adicional quando destinado", () => {
    expect(productStoreStatus({ ...base, store: { orderedQuantity: "0.00", destinedQuantity: "1.00" } }).label).toBe("Adicional");
    expect(productStoreStatus({ ...base, store: undefined }).kind).toBe("no-order");
  });

  it("prioriza o bloqueio de custos", () => {
    expect(
      productStoreStatus({ ...base, blockedByCosts: true, store: { orderedQuantity: "2.00", destinedQuantity: "0.00" } }).kind,
    ).toBe("blocked");
  });
});

describe("isProductPending", () => {
  const base = { blockedByCosts: false, hasDestinedInStore: false };

  it("é pendente enquanto nada foi gravado para a loja em nenhum fornecedor", () => {
    expect(isProductPending({ ...base, store: { orderedQuantity: "2.00", persistedDestinedQuantity: null } })).toBe(true);
    expect(isProductPending({ ...base, store: { orderedQuantity: "2.00", persistedDestinedQuantity: "0.00" } })).toBe(true);
    expect(isProductPending({ ...base, store: { orderedQuantity: "2.00", persistedDestinedQuantity: "2.00" } })).toBe(false);
    expect(
      isProductPending({ ...base, store: { orderedQuantity: "2.00", persistedDestinedQuantity: null }, destinedInOtherSuppliers: "1.00" }),
    ).toBe(false);
  });

  it("não marca pendente o que não foi pedido", () => {
    expect(isProductPending({ ...base, store: { orderedQuantity: "0.00", persistedDestinedQuantity: null } })).toBe(false);
  });

  it("produto bloqueado nos custos só fica pendente se houver destinação indevida a zerar", () => {
    const store = { orderedQuantity: "2.00", persistedDestinedQuantity: null };
    expect(isProductPending({ ...base, blockedByCosts: true, store })).toBe(false);
    expect(isProductPending({ ...base, blockedByCosts: true, hasDestinedInStore: true, store })).toBe(true);
  });
});

describe("suggestionLabel", () => {
  it("usa 'Usar pedido' para o pedido inteiro e 'Usar saldo' quando parte já foi destinada", () => {
    expect(suggestionLabel({ orderedQuantity: "8.00", suggestedQuantity: "8.00" })).toBe("Usar pedido · 8");
    expect(suggestionLabel({ orderedQuantity: "6.00", suggestedQuantity: "2.00" })).toBe("Usar saldo · 2");
    expect(suggestionLabel({ orderedQuantity: "6.00", suggestedQuantity: "0.00" })).toBeNull();
  });
});

describe("fornecedores no seletor", () => {
  it("gera iniciais legíveis", () => {
    expect(supplierInitials("Levi Scardua")).toBe("LS");
    expect(supplierInitials("Ademar")).toBe("AD");
    expect(supplierInitials("Casa de Frutas")).toBe("CF");
    expect(supplierInitials("  ")).toBe("?");
  });

  it("ordena atual, depois pendentes, por fim conferidos", () => {
    const list = [
      supplier("a", "Copperfruti", ["pf"]),
      supplier("b", "Ademar"),
      supplier("c", "Levi"),
      supplier("d", "Washington", ["pf"]),
    ];
    expect(sortSuppliersForPicker(list, "b", "pf").map((s) => s.id)).toEqual(["b", "c", "a", "d"]);
    expect(sortSuppliersForPicker(list, null, "ba").map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("busca por nome fantasia ou razão social, ignorando acentos", () => {
    const list = [supplier("a", "União Frutas"), supplier("b", "Levi")];
    expect(filterSuppliers(list, "uniao").map((s) => s.id)).toEqual(["a"]);
    expect(filterSuppliers(list, "comercio")).toHaveLength(2);
    expect(filterSuppliers(list, "  ")).toHaveLength(2);
  });
});

describe("storeProgress", () => {
  it("mostra loja não iniciada, em andamento e finalizada", () => {
    expect(storeProgress(summary({ totalOrderedProducts: 19, totalPendingProducts: 19 }))).toMatchObject({
      state: "not-started",
      done: 0,
      total: 19,
      percent: 0,
    });
    expect(
      storeProgress(summary({ totalOrderedProducts: 33, totalReviewedProducts: 19, totalPendingProducts: 14 })),
    ).toMatchObject({ state: "in-progress", done: 19, total: 33, pending: 14, percent: 58 });
    expect(
      storeProgress(summary({ totalOrderedProducts: 36, totalReviewedProducts: 36, closureStatus: "CLOSED" })),
    ).toMatchObject({ state: "finalized", percent: 100, pending: 0 });
  });

  it("indica reconferência quando a finalização ficou desatualizada", () => {
    expect(storeProgress(summary({ closureStatus: "CLOSED", isStale: true })).state).toBe("stale");
    expect(storeProgress(undefined).state).toBe("not-started");
  });
});

describe("conferência de cortes", () => {
  it("lista primeiro cortes totais, depois parciais e adicionais; atendidos à parte", () => {
    const { attention, fulfilled } = splitClosureItems([
      cut("Uva", "FULFILLED", "2.00", "2.00"),
      cut("Gengibre", "ADDITIONAL", "0.00", "1.00"),
      cut("Pera", "PARTIAL_CUT", "3.00", "2.00", "1.00"),
      cut("Tomate", "TOTAL_CUT", "8.00", "0.00", "8.00"),
    ]);
    expect(attention.map((c) => c.productName)).toEqual(["Tomate", "Pera", "Gengibre"]);
    expect(fulfilled.map((c) => c.productName)).toEqual(["Uva"]);
  });

  it("descreve cada item de forma curta", () => {
    expect(closureItemTag(cut("Pera", "PARTIAL_CUT", "3.00", "2.00", "1.00"))).toEqual({
      label: "−1 CX",
      tone: "partial",
      detail: "Pedido 3 CX · destinado 2",
    });
    expect(closureItemTag(cut("Gengibre", "ADDITIONAL", "0.00", "1.00")).detail).toBe("Sem pedido · destinado 1 CX");
    expect(closureItemTag(cut("Tomate", "TOTAL_CUT", "8.00", "0.00", "8.00")).label).toBe("Corte total");
  });
});
