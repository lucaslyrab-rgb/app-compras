import { describe, expect, it } from "vitest";
import {
  MAX_RANGE_DAYS,
  ReconciliationFilterError,
  buildKpis,
  buildReconciliationLines,
  cutSituation,
  expectedWeight,
  filterLines,
  groupDestinations,
  hasAttention,
  normalizeUnit,
  resolveFilters,
  weightMessage,
  weightRange,
  type ReconciliationSources,
  type SourceAllocation,
} from "@/modules/purchasing/reconciliation/domain";

const CYCLE = "2026-10-27";
const STORE = "s-ponta";
const STORE_B = "s-balneario";

function alloc(partial: Partial<SourceAllocation> = {}): SourceAllocation {
  return {
    cycleDate: CYCLE,
    storeId: STORE,
    productId: "p-abacate",
    supplierId: "sup-1",
    supplierName: "Ademar",
    destinedQuantity: 3,
    purchaseFormat: "CX",
    isAdditionalPurchase: false,
    conversionFactorKg: 20,
    ...partial,
  };
}

function sources(partial: Partial<ReconciliationSources> = {}): ReconciliationSources {
  return {
    stores: [
      { id: STORE, name: "MultiShow Ponta da Fruta" },
      { id: STORE_B, name: "MultiShow Balneário" },
    ],
    products: [
      { id: "p-abacate", erpCode: 1, name: "ABACATE KG", purchaseFormat: "CX", saleUnit: "KG", conversionQuantity: 20 },
      { id: "p-abacaxi", erpCode: 736, name: "ABACAXI UN", purchaseFormat: "UND", saleUnit: "UND", conversionQuantity: 10 },
      { id: "p-tomate", erpCode: 169, name: "TOMATE KG", purchaseFormat: "CX", saleUnit: "KG", conversionQuantity: 20 },
      { id: "p-gengibre", erpCode: 75, name: "GENGIBRE KG", purchaseFormat: "CX", saleUnit: "KG", conversionQuantity: 10 },
    ],
    referenceOrders: [{ cycleDate: CYCLE, storeId: STORE, orderId: "o-2", revision: 2, source: "CLOSURE" }],
    orderItems: [],
    allocations: [],
    notPurchased: [],
    conferences: [{ cycleDate: CYCLE, storeId: STORE, status: "FINALIZED", orderRevision: 2 }],
    conferenceItems: [],
    ...partial,
  };
}

describe("normalizeUnit", () => {
  it("normaliza grafias sem aplicar conversão", () => {
    expect(normalizeUnit(" kg ")).toBe("KG");
    expect(normalizeUnit("Quilo")).toBe("KG");
    expect(normalizeUnit("und")).toBe("UN");
    expect(normalizeUnit("Caixa")).toBe("CX");
    expect(normalizeUnit("SC")).toBe("SC");
    expect(normalizeUnit(null)).toBe("");
  });
});

describe("situação pedido × destinação", () => {
  const cx = (quantity: number) => groupDestinations([alloc({ destinedQuantity: quantity })]);

  it("Integral quando destinado = pedido", () => {
    expect(cutSituation(15, "CX", cx(15))).toEqual({ situation: "INTEGRAL", difference: 0, unit: "CX" });
  });

  it("Corte parcial com a diferença negativa", () => {
    expect(cutSituation(10, "CX", cx(8))).toEqual({ situation: "PARTIAL_CUT", difference: -2, unit: "CX" });
  });

  it("Corte total quando nada foi destinado", () => {
    expect(cutSituation(8, "CX", [])).toEqual({ situation: "TOTAL_CUT", difference: -8, unit: "CX" });
  });

  it("Adicional sem pedido e acima do pedido", () => {
    expect(cutSituation(null, null, cx(1))).toEqual({ situation: "ADDITIONAL", difference: 1, unit: "CX" });
    expect(cutSituation(5, "CX", cx(7))).toEqual({ situation: "ADDITIONAL", difference: 2, unit: "CX" });
  });

  it("não compara unidades diferentes", () => {
    expect(cutSituation(5, "CX", groupDestinations([alloc({ purchaseFormat: "KG", destinedQuantity: 100 })])).situation).toBe(
      "NOT_COMPARABLE",
    );
  });

  it("não soma fornecedores com formatos diferentes", () => {
    const groups = groupDestinations([
      alloc({ supplierId: "a", supplierName: "A", destinedQuantity: 2, purchaseFormat: "CX" }),
      alloc({ supplierId: "b", supplierName: "B", destinedQuantity: 30, purchaseFormat: "KG" }),
      alloc({ supplierId: "c", supplierName: "C", destinedQuantity: 1, purchaseFormat: "cx" }),
    ]);
    expect(groups).toEqual([
      { unit: "CX", quantity: 3, suppliers: ["A", "C"], supplierIds: ["a", "c"] },
      { unit: "KG", quantity: 30, suppliers: ["B"], supplierIds: ["b"] },
    ]);
    expect(cutSituation(3, "CX", groups).situation).toBe("NOT_COMPARABLE");
  });
});

describe("peso esperado pela conversão cadastrada", () => {
  const kgProduct = { saleUnit: "KG", conversionQuantity: 18 };

  it("usa o fator copiado na destinação", () => {
    expect(expectedWeight([alloc({ destinedQuantity: 3, conversionFactorKg: 20 })], kgProduct)).toEqual({
      kg: 60,
      source: "DESTINATION_FACTOR",
    });
  });

  it("usa a conversão atual do cadastro quando a destinação não tem fator", () => {
    expect(expectedWeight([alloc({ destinedQuantity: 2, conversionFactorKg: null })], kgProduct)).toEqual({
      kg: 36,
      source: "CURRENT_PRODUCT",
    });
  });

  it("não calcula para produto vendido por unidade", () => {
    expect(expectedWeight([alloc()], { saleUnit: "UND", conversionQuantity: 10 })).toEqual({
      kg: null,
      reason: "NO_KG_CONVERSION",
    });
  });

  it("usa a própria quantidade quando a destinação já está em KG", () => {
    expect(expectedWeight([alloc({ purchaseFormat: "KG", destinedQuantity: 42.5 })], kgProduct)).toEqual({
      kg: 42.5,
      source: "DESTINED_IN_KG",
    });
  });

  it("soma fornecedores com fatores diferentes", () => {
    expect(
      expectedWeight(
        [alloc({ destinedQuantity: 2, conversionFactorKg: 20 }), alloc({ supplierId: "x", destinedQuantity: 1, conversionFactorKg: 18 })],
        kgProduct,
      ),
    ).toEqual({ kg: 58, source: "DESTINATION_FACTOR" });
  });

  it("sem destinação ou sem fator algum", () => {
    expect(expectedWeight([], kgProduct)).toEqual({ kg: null, reason: "NO_DESTINATION" });
    expect(expectedWeight([alloc({ conversionFactorKg: null })], { saleUnit: "KG", conversionQuantity: null })).toEqual({
      kg: null,
      reason: "MISSING_FACTOR",
    });
  });
});

describe("faixas de pesagem (verde, laranja, vermelho)", () => {
  it.each([
    [60, 60, "OK"],
    [60, 61.5, "OK"],
    [60, 63, "OK"], // exatamente +5%
    [60, 63.01, "OUT_OF_RANGE"],
    [60, 59.99, "SLIGHTLY_BELOW"],
    [60, 58.2, "SLIGHTLY_BELOW"],
    [60, 57, "SLIGHTLY_BELOW"], // exatamente −5%
    [60, 56.99, "OUT_OF_RANGE"],
    [60, 52.3, "OUT_OF_RANGE"],
    [60, 66.6, "OUT_OF_RANGE"],
  ] as const)("esperado %s kg, conferido %s kg → %s", (expected, received, range) => {
    expect(weightRange(expected, received).range).toBe(range);
  });

  it("calcula diferença em kg e % e monta a mensagem do vermelho", () => {
    const below = weightRange(60, 52.3);
    expect(below).toEqual({ differenceKg: -7.7, differencePercent: -12.8, range: "OUT_OF_RANGE" });
    expect(weightMessage(below)).toBe("Pesagem 12,8% abaixo do esperado (−7,70 kg)");
    expect(weightMessage(weightRange(60, 66.6))).toBe("Pesagem 11,0% acima do esperado (+6,60 kg)");
    expect(weightMessage(weightRange(60, 58.2))).toBeNull();
  });
});

describe("montagem das linhas e destaques", () => {
  it("linha completa: pedido, destinação, esperado e pesagem fora da faixa", () => {
    const [line] = buildReconciliationLines(
      sources({
        orderItems: [{ cycleDate: CYCLE, storeId: STORE, productId: "p-abacate", quantity: 3 }],
        allocations: [alloc()],
        conferenceItems: [
          { cycleDate: CYCLE, storeId: STORE, productId: "p-abacate", receivedWeightKg: 52.3, isUnreceived: false, removedFromOrder: false },
        ],
      }),
    );
    expect(line.order).toMatchObject({ quantity: 3, unit: "CX", revision: 2, source: "CLOSURE", unitFromCurrentProduct: false });
    expect(line.cut.situation).toBe("INTEGRAL");
    expect(line.expected).toEqual({ kg: 60, source: "DESTINATION_FACTOR" });
    expect(line.weight?.range).toBe("OUT_OF_RANGE");
    expect(line.highlights).toEqual(["WEIGHT_OUT_OF_RANGE"]);
    expect(hasAttention(line)).toBe(true);
  });

  it("corte total com decisão de não compra não é destaque", () => {
    const [line] = buildReconciliationLines(
      sources({
        orderItems: [{ cycleDate: CYCLE, storeId: STORE, productId: "p-tomate", quantity: 8 }],
        notPurchased: [{ cycleDate: CYCLE, storeId: STORE, productId: "p-tomate" }],
      }),
    );
    expect(line.cut.situation).toBe("TOTAL_CUT");
    expect(line.notPurchased).toBe(true);
    expect(line.highlights).toEqual([]);
  });

  it("adicional sem item na conferência fica fora da conferência", () => {
    const [line] = buildReconciliationLines(sources({ allocations: [alloc({ productId: "p-gengibre", destinedQuantity: 1, isAdditionalPurchase: true })] }));
    expect(line.order).toBeNull();
    expect(line.cut.situation).toBe("ADDITIONAL");
    expect(line.highlights).toEqual(["DESTINED_OUT_OF_CONFERENCE"]);
  });

  it("não recebido e recebido sem destinação", () => {
    const lines = buildReconciliationLines(
      sources({
        orderItems: [
          { cycleDate: CYCLE, storeId: STORE, productId: "p-abacate", quantity: 3 },
          { cycleDate: CYCLE, storeId: STORE, productId: "p-tomate", quantity: 2 },
        ],
        allocations: [alloc()],
        conferenceItems: [
          { cycleDate: CYCLE, storeId: STORE, productId: "p-abacate", receivedWeightKg: 0, isUnreceived: true, removedFromOrder: false },
          { cycleDate: CYCLE, storeId: STORE, productId: "p-tomate", receivedWeightKg: 35, isUnreceived: false, removedFromOrder: false },
        ],
      }),
    );
    const byProduct = Object.fromEntries(lines.map((l) => [l.productId, l]));
    expect(byProduct["p-abacate"].highlights).toEqual(["NOT_RECEIVED"]);
    expect(byProduct["p-abacate"].weight).toBeNull();
    expect(byProduct["p-tomate"].highlights).toEqual(["RECEIVED_NOT_DESTINED"]);
  });

  it("conferência em andamento ou inexistente gera apenas contexto", () => {
    const [line] = buildReconciliationLines(sources({ allocations: [alloc()], conferences: [] }));
    expect(line.conference.state).toBe("NONE");
    expect(line.highlights).toEqual(["CONFERENCE_PENDING"]);
    expect(hasAttention(line)).toBe(false);
  });

  it("produto vendido por unidade nunca recebe destaque de pesagem", () => {
    const [line] = buildReconciliationLines(
      sources({
        allocations: [alloc({ productId: "p-abacaxi", purchaseFormat: "UND", destinedQuantity: 10, conversionFactorKg: 10 })],
        conferenceItems: [
          { cycleDate: CYCLE, storeId: STORE, productId: "p-abacaxi", receivedWeightKg: 3, isUnreceived: false, removedFromOrder: false },
        ],
      }),
    );
    expect(line.expected).toEqual({ kg: null, reason: "NO_KG_CONVERSION" });
    expect(line.weight).toBeNull();
    expect(line.highlights).toEqual([]);
  });

  it("indica conferência feita sobre revisão diferente da referência", () => {
    const [line] = buildReconciliationLines(
      sources({
        orderItems: [{ cycleDate: CYCLE, storeId: STORE, productId: "p-abacate", quantity: 3 }],
        allocations: [alloc()],
        conferences: [{ cycleDate: CYCLE, storeId: STORE, status: "FINALIZED", orderRevision: 1 }],
        conferenceItems: [
          { cycleDate: CYCLE, storeId: STORE, productId: "p-abacate", receivedWeightKg: 61, isUnreceived: false, removedFromOrder: true },
        ],
      }),
    );
    expect(line.conference.revisionDiffers).toBe(true);
    expect(line.conference.item?.removedFromOrder).toBe(true);
    expect(line.weight?.range).toBe("OK");
  });

  it("ignora itens de conferência cancelada", () => {
    const lines = buildReconciliationLines(
      sources({
        conferences: [{ cycleDate: CYCLE, storeId: STORE, status: "CANCELLED", orderRevision: 2 }],
        conferenceItems: [
          { cycleDate: CYCLE, storeId: STORE, productId: "p-tomate", receivedWeightKg: 20, isUnreceived: false, removedFromOrder: false },
        ],
      }),
    );
    expect(lines).toEqual([]);
  });

  it("usa a unidade atual do cadastro quando não há destinação", () => {
    const [line] = buildReconciliationLines(
      sources({ orderItems: [{ cycleDate: CYCLE, storeId: STORE, productId: "p-tomate", quantity: 8 }] }),
    );
    expect(line.order).toMatchObject({ unit: "CX", unitFromCurrentProduct: true });
  });
});

describe("filtros, indicadores e período", () => {
  const lines = buildReconciliationLines(
    sources({
      orderItems: [
        { cycleDate: CYCLE, storeId: STORE, productId: "p-abacate", quantity: 3 },
        { cycleDate: CYCLE, storeId: STORE, productId: "p-tomate", quantity: 8 },
      ],
      allocations: [alloc(), alloc({ productId: "p-gengibre", supplierId: "sup-2", supplierName: "Beto", destinedQuantity: 1 })],
      conferenceItems: [
        { cycleDate: CYCLE, storeId: STORE, productId: "p-abacate", receivedWeightKg: 58.2, isUnreceived: false, removedFromOrder: false },
      ],
    }),
  );

  it("somente com destaque, por situação, fornecedor e busca", () => {
    expect(filterLines(lines, { onlyAttention: true }).map((l) => l.productId)).toEqual(["p-gengibre"]);
    expect(filterLines(lines, { onlyAttention: false, situation: "TOTAL_CUT" }).map((l) => l.productId)).toEqual(["p-tomate"]);
    expect(filterLines(lines, { onlyAttention: false, supplierId: "sup-2" }).map((l) => l.productId)).toEqual(["p-gengibre"]);
    expect(filterLines(lines, { onlyAttention: false, search: "abacáte" }).map((l) => l.productId)).toEqual(["p-abacate"]);
    expect(filterLines(lines, { onlyAttention: false, search: "169" }).map((l) => l.productId)).toEqual(["p-tomate"]);
  });

  it("indicadores consideram todas as linhas", () => {
    expect(buildKpis(lines)).toEqual({
      totalLines: 3,
      attentionLines: 1,
      weightOk: 0,
      weightSlightlyBelow: 1,
      weightOutOfRange: 0,
      notReceived: 0,
      receivedNotDestined: 0,
      outOfConference: 1,
      pendingConferences: 0,
    });
  });

  it("período padrão de 7 dias, somente com destaque ligado", () => {
    expect(resolveFilters({}, "2026-10-29")).toMatchObject({
      startDate: "2026-10-23",
      endDate: "2026-10-29",
      onlyAttention: true,
    });
    expect(resolveFilters({ onlyAttention: "0" }, "2026-10-29").onlyAttention).toBe(false);
  });

  it("recusa período acima do limite, invertido ou inválido", () => {
    expect(() => resolveFilters({ startDate: "2026-09-01", endDate: "2026-10-29" }, "2026-10-29")).toThrow(
      new ReconciliationFilterError(`O período máximo de consulta é de ${MAX_RANGE_DAYS} dias.`),
    );
    expect(() => resolveFilters({ startDate: "2026-10-29", endDate: "2026-10-01" }, "2026-10-29")).toThrow(ReconciliationFilterError);
    expect(() => resolveFilters({ startDate: "2026-02-30" }, "2026-10-29")).toThrow(ReconciliationFilterError);
  });

  it("ignora situação e destaque desconhecidos", () => {
    const filters = resolveFilters({ situation: "XPTO", highlight: "NOPE" }, "2026-10-29");
    expect(filters.situation).toBeUndefined();
    expect(filters.highlight).toBeUndefined();
  });
});
