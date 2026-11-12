/**
 * Fechamento integrado por ciclo (v1.2) — regras puras.
 *
 * Duas visões sobre as mesmas fontes do confronto (ver domain.ts):
 * - Caminho dos produtos: o que aconteceu com cada produto no ciclo
 *   (pedido → compra → destinação → conferência) e o desfecho.
 * - Valor por loja: quanto foi comprado para cada loja (destinado × custo do
 *   ciclo) e quanto chegou pela conferência, por fornecedor.
 *
 * Nada aqui grava ou bloqueia: é só leitura e cálculo.
 */
import {
  ATTENTION_HIGHLIGHTS,
  normalizeUnit,
  round2,
  type ConferenceState,
  type ReconciliationLine,
  type ReconciliationSources,
} from "./domain";

// ---------------------------------------------------------------------------
// Caminho dos produtos
// ---------------------------------------------------------------------------

export type JourneyIssue =
  | "NOT_PURCHASED"
  | "PURCHASED_NOT_DESTINED"
  | "CONFERENCE_DIFFERENCE"
  | "CUT"
  | "ADDITIONAL"
  | "CONFERENCE_PENDING";

/** Ordem de gravidade: o primeiro problema encontrado é o desfecho principal. */
export const JOURNEY_ISSUE_ORDER: readonly JourneyIssue[] = [
  "NOT_PURCHASED",
  "PURCHASED_NOT_DESTINED",
  "CONFERENCE_DIFFERENCE",
  "CUT",
  "ADDITIONAL",
  "CONFERENCE_PENDING",
];

export const JOURNEY_FILTERS = [
  "NOT_PURCHASED",
  "PURCHASED_NOT_DESTINED",
  "CUT",
  "CONFERENCE_DIFFERENCE",
  "CONFERENCE_PENDING",
  "OK",
] as const;
export type JourneyFilter = (typeof JOURNEY_FILTERS)[number];

export const JOURNEY_FILTER_LABELS: Record<JourneyFilter, string> = {
  NOT_PURCHASED: "Não comprados",
  PURCHASED_NOT_DESTINED: "Sem destinação",
  CUT: "Cortes",
  CONFERENCE_DIFFERENCE: "Diferença na conferência",
  CONFERENCE_PENDING: "Conferência pendente",
  OK: "Tudo certo",
};

export type QuantityGroup = { unit: string; quantity: number };

export type JourneySupplier = {
  supplierId: string;
  supplierName: string;
  unit: string;
  quantity: number;
  stores: { storeId: string; storeName: string; quantity: number }[];
  invoices: string[];
};

export type ProductJourney = {
  productId: string;
  erpCode: number;
  productName: string;
  /** Formato de compra do cadastro (unidade do custo), ex.: CX. */
  unit: string;
  order: { groups: QuantityGroup[]; stores: number } | null;
  purchase: { purchased: boolean; cost: number | null; by: string | null };
  destination: { groups: QuantityGroup[]; stores: number; suppliers: JourneySupplier[] } | null;
  conference: {
    storesWithDestination: number;
    storesFinalized: number;
    expectedKg: number;
    receivedKg: number;
    /** Diferença percentual só sobre o que foi pesado; null sem pesagem comparável. */
    percent: number | null;
    notReceived: number;
  } | null;
  /** Soma dos cortes (negativo) e dos adicionais (positivo) na mesma unidade. */
  cut: { difference: number | null; unit: string | null; stores: number } | null;
  additional: { difference: number | null; unit: string | null; stores: number } | null;
  issues: JourneyIssue[];
  lines: ReconciliationLine[];
};

function sumGroups(entries: { unit: string; quantity: number }[]): QuantityGroup[] {
  const map = new Map<string, number>();
  for (const entry of entries) {
    if (!(entry.quantity > 0)) continue;
    const unit = normalizeUnit(entry.unit);
    map.set(unit, round2((map.get(unit) ?? 0) + entry.quantity));
  }
  return [...map.entries()].map(([unit, quantity]) => ({ unit, quantity })).sort((a, b) => a.unit.localeCompare(b.unit));
}

function sumDifferences(lines: ReconciliationLine[]): { difference: number | null; unit: string | null; stores: number } {
  const units = new Set(lines.map((l) => l.cut.unit));
  const comparable = lines.every((l) => l.cut.difference !== null) && units.size === 1;
  return {
    difference: comparable ? round2(lines.reduce((sum, l) => sum + (l.cut.difference ?? 0), 0)) : null,
    unit: comparable ? (lines[0].cut.unit ?? null) : null,
    stores: lines.length,
  };
}

/**
 * Monta o caminho de cada produto no ciclo. As linhas são as do confronto
 * (loja × produto); com `storeId`, mostra só aquela loja, mas "foi destinado"
 * e "foi comprado" continuam valendo para o ciclo inteiro.
 */
export function buildProductJourneys(
  sources: ReconciliationSources,
  lines: readonly ReconciliationLine[],
  options: { cycleDate: string; storeId?: string },
): ProductJourney[] {
  const { cycleDate, storeId } = options;
  const cycleLines = lines.filter((l) => l.cycleDate === cycleDate);
  const products = new Map(sources.products.map((p) => [p.id, p]));
  const stores = new Map(sources.stores.map((s) => [s.id, s.name]));
  const costs = new Map(
    (sources.costs ?? []).filter((c) => c.cycleDate === cycleDate).map((c) => [c.productId, c]),
  );

  const destinedAnywhere = new Set(cycleLines.filter((l) => l.destinedPositive).map((l) => l.productId));

  const invoicesByPair = new Map<string, string[]>();
  for (const inv of sources.invoices ?? []) {
    if (inv.cycleDate !== cycleDate) continue;
    const key = `${inv.storeId}|${inv.supplierId}`;
    const list = invoicesByPair.get(key) ?? [];
    if (!list.includes(inv.invoiceNumber)) list.push(inv.invoiceNumber);
    invoicesByPair.set(key, list);
  }

  const linesByProduct = new Map<string, ReconciliationLine[]>();
  for (const line of cycleLines) {
    if (storeId && line.storeId !== storeId) continue;
    const list = linesByProduct.get(line.productId) ?? [];
    list.push(line);
    linesByProduct.set(line.productId, list);
  }
  // Comprado sem pedido e sem destinação ainda é um caminho (só sem filtro de loja).
  if (!storeId) {
    for (const cost of costs.values()) {
      if (cost.purchased && !linesByProduct.has(cost.productId) && products.has(cost.productId)) {
        linesByProduct.set(cost.productId, []);
      }
    }
  }

  const journeys: ProductJourney[] = [];
  for (const [productId, productLines] of linesByProduct) {
    const product = products.get(productId);
    if (!product) continue;
    productLines.sort((a, b) => a.storeName.localeCompare(b.storeName, "pt-BR"));
    const storeIds = new Set(productLines.map((l) => l.storeId));

    const orderLines = productLines.filter((l) => l.order);
    const order = orderLines.length
      ? { groups: sumGroups(orderLines.map((l) => ({ unit: l.order!.unit, quantity: l.order!.quantity }))), stores: orderLines.length }
      : null;

    const cost = costs.get(productId);
    const purchase = { purchased: Boolean(cost?.purchased), cost: cost?.cost ?? null, by: cost?.updatedByName ?? null };

    const destinedLines = productLines.filter((l) => l.destinedPositive);
    const supplierMap = new Map<string, JourneySupplier>();
    for (const alloc of sources.allocations) {
      if (alloc.cycleDate !== cycleDate || alloc.productId !== productId || !(alloc.destinedQuantity > 0)) continue;
      if (!storeIds.has(alloc.storeId)) continue;
      const entry = supplierMap.get(alloc.supplierId) ?? {
        supplierId: alloc.supplierId,
        supplierName: alloc.supplierName,
        unit: normalizeUnit(alloc.purchaseFormat),
        quantity: 0,
        stores: [],
        invoices: [],
      };
      entry.quantity = round2(entry.quantity + alloc.destinedQuantity);
      entry.stores.push({ storeId: alloc.storeId, storeName: stores.get(alloc.storeId) ?? "Loja", quantity: alloc.destinedQuantity });
      for (const number of invoicesByPair.get(`${alloc.storeId}|${alloc.supplierId}`) ?? []) {
        if (!entry.invoices.includes(number)) entry.invoices.push(number);
      }
      supplierMap.set(alloc.supplierId, entry);
    }
    const suppliers = [...supplierMap.values()].sort((a, b) => b.quantity - a.quantity || a.supplierName.localeCompare(b.supplierName, "pt-BR"));
    for (const s of suppliers) s.stores.sort((a, b) => a.storeName.localeCompare(b.storeName, "pt-BR"));
    const destination = destinedLines.length
      ? {
          groups: sumGroups(destinedLines.flatMap((l) => l.destinations.map((d) => ({ unit: d.unit, quantity: d.quantity })))),
          stores: destinedLines.length,
          suppliers,
        }
      : null;

    let conference: ProductJourney["conference"] = null;
    if (destinedLines.length) {
      const weighed = destinedLines.filter((l) => l.weight && l.expected.kg !== null && l.conference.item?.weightKg != null);
      const expectedKg = round2(weighed.reduce((sum, l) => sum + (l.expected.kg ?? 0), 0));
      const receivedKg = round2(weighed.reduce((sum, l) => sum + (l.conference.item?.weightKg ?? 0), 0));
      conference = {
        storesWithDestination: destinedLines.length,
        storesFinalized: destinedLines.filter((l) => l.conference.state === "FINALIZED").length,
        expectedKg,
        receivedKg,
        percent: expectedKg > 0 ? Math.round(((receivedKg - expectedKg) / expectedKg) * 1000) / 10 : null,
        notReceived: destinedLines.filter((l) => l.highlights.includes("NOT_RECEIVED")).length,
      };
    }

    const destinedSomewhere = destinedAnywhere.has(productId);
    const cutLines = productLines.filter((l) => l.cut.situation === "PARTIAL_CUT" || l.cut.situation === "TOTAL_CUT");
    const additionalLines = productLines.filter((l) => l.cut.situation === "ADDITIONAL" && l.destinedPositive);

    const issues = new Set<JourneyIssue>();
    if (order && !destinedSomewhere && !purchase.purchased) issues.add("NOT_PURCHASED");
    if (purchase.purchased && !destinedSomewhere) issues.add("PURCHASED_NOT_DESTINED");
    if (productLines.some((l) => l.highlights.some((h) => ATTENTION_HIGHLIGHTS.includes(h)))) issues.add("CONFERENCE_DIFFERENCE");
    if (destinedSomewhere && cutLines.length) issues.add("CUT");
    if (additionalLines.length) issues.add("ADDITIONAL");
    if (productLines.some((l) => l.highlights.includes("CONFERENCE_PENDING"))) issues.add("CONFERENCE_PENDING");

    journeys.push({
      productId,
      erpCode: product.erpCode,
      productName: product.name,
      unit: normalizeUnit(product.purchaseFormat ?? ""),
      order,
      purchase,
      destination,
      conference,
      cut: destinedSomewhere && cutLines.length ? sumDifferences(cutLines) : null,
      additional: additionalLines.length ? sumDifferences(additionalLines) : null,
      issues: JOURNEY_ISSUE_ORDER.filter((i) => issues.has(i)),
      lines: productLines,
    });
  }

  const rank = (j: ProductJourney) => (j.issues.length ? JOURNEY_ISSUE_ORDER.indexOf(j.issues[0]) : JOURNEY_ISSUE_ORDER.length);
  return journeys.sort((a, b) => rank(a) - rank(b) || a.productName.localeCompare(b.productName, "pt-BR"));
}

export function journeyMatches(journey: ProductJourney, filter: JourneyFilter | undefined): boolean {
  if (!filter) return true;
  if (filter === "OK") return journey.issues.length === 0;
  return journey.issues.includes(filter);
}

function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function filterJourneys(
  journeys: readonly ProductJourney[],
  filters: { filter?: JourneyFilter; search?: string },
): ProductJourney[] {
  const search = filters.search ? normalizeSearch(filters.search) : "";
  return journeys.filter(
    (j) =>
      journeyMatches(j, filters.filter) &&
      (!search || normalizeSearch(`${j.erpCode} ${j.productName}`).includes(search)),
  );
}

export type JourneySummary = {
  ordered: { products: number; groups: QuantityGroup[]; stores: number };
  purchased: { products: number; notPurchased: number };
  destined: { products: number; purchasedNotDestined: number };
  conference: { storesWithDestination: number; storesFinalized: number; withDifference: number; pending: number };
  counts: Record<JourneyFilter, number>;
  total: number;
};

export function summarizeJourneys(journeys: readonly ProductJourney[]): JourneySummary {
  const counts = Object.fromEntries(JOURNEY_FILTERS.map((f) => [f, 0])) as Record<JourneyFilter, number>;
  for (const j of journeys) for (const f of JOURNEY_FILTERS) if (journeyMatches(j, f)) counts[f] += 1;

  const orderStores = new Set<string>();
  const destinedStores = new Set<string>();
  const finalizedStores = new Set<string>();
  for (const j of journeys) {
    for (const l of j.lines) {
      if (l.order) orderStores.add(l.storeId);
      if (l.destinedPositive) {
        destinedStores.add(l.storeId);
        if (l.conference.state === "FINALIZED") finalizedStores.add(l.storeId);
      }
    }
  }
  return {
    ordered: {
      products: journeys.filter((j) => j.order).length,
      groups: sumGroups(journeys.flatMap((j) => j.order?.groups ?? [])),
      stores: orderStores.size,
    },
    purchased: { products: journeys.filter((j) => j.purchase.purchased).length, notPurchased: counts.NOT_PURCHASED },
    destined: { products: journeys.filter((j) => j.destination).length, purchasedNotDestined: counts.PURCHASED_NOT_DESTINED },
    conference: {
      storesWithDestination: destinedStores.size,
      storesFinalized: finalizedStores.size,
      withDifference: counts.CONFERENCE_DIFFERENCE,
      pending: counts.CONFERENCE_PENDING,
    },
    counts,
    total: journeys.length,
  };
}

// ---------------------------------------------------------------------------
// Valor por loja
// ---------------------------------------------------------------------------

export type SupplierValue = {
  supplierId: string;
  supplierName: string;
  invoices: string[];
  products: number;
  purchasedValue: number;
  receivedValue: number | null;
  difference: number | null;
};

export type StoreValue = {
  storeId: string;
  storeName: string;
  products: number;
  purchasedValue: number;
  /** Participação no valor comprado do ciclo, 0 a 100. */
  share: number;
  conference: { state: ConferenceState; totalItems: number; verifiedItems: number };
  receivedValue: number | null;
  difference: number | null;
  differencePercent: number | null;
  /** Produtos destinados sem custo lançado (ficam fora do valor). */
  missingCost: number;
  suppliers: SupplierValue[];
};

export type StoreValuesResult = {
  stores: StoreValue[];
  totals: {
    purchasedValue: number;
    products: number;
    suppliers: number;
    storesFinalized: number;
    receivedValue: number;
    purchasedOfFinalized: number;
    difference: number;
    differencePercent: number | null;
    missingCost: number;
  };
};

/**
 * Fração do valor comprado que chegou à loja, pela conferência finalizada:
 * não recebido = 0; pesado = peso conferido ÷ peso esperado; sem pesagem
 * comparável (ex.: vendido por unidade) = valor comprado.
 */
export function receivedRatio(line: ReconciliationLine | undefined): number {
  if (!line) return 1;
  const item = line.conference.item;
  if (item?.isUnreceived) return 0;
  if (line.weight && line.expected.kg && line.expected.kg > 0 && item?.weightKg != null) {
    return item.weightKg / line.expected.kg;
  }
  return 1;
}

export function buildStoreValues(
  sources: ReconciliationSources,
  lines: readonly ReconciliationLine[],
  cycleDate: string,
): StoreValuesResult {
  const costs = new Map((sources.costs ?? []).filter((c) => c.cycleDate === cycleDate).map((c) => [c.productId, c.cost]));
  const lineByKey = new Map(lines.filter((l) => l.cycleDate === cycleDate).map((l) => [`${l.storeId}|${l.productId}`, l]));
  const conferences = new Map(
    sources.conferences.filter((c) => c.cycleDate === cycleDate).map((c) => [c.storeId, c]),
  );
  const invoices = new Map<string, string[]>();
  for (const inv of sources.invoices ?? []) {
    if (inv.cycleDate !== cycleDate) continue;
    const key = `${inv.storeId}|${inv.supplierId}`;
    const list = invoices.get(key) ?? [];
    if (!list.includes(inv.invoiceNumber)) list.push(inv.invoiceNumber);
    invoices.set(key, list);
  }

  type Acc = StoreValue & { productIds: Set<string>; supplierMap: Map<string, SupplierValue & { productIds: Set<string> }> };
  const byStore = new Map<string, Acc>();
  const storeName = new Map(sources.stores.map((s) => [s.id, s.name]));
  const ensure = (storeId: string): Acc => {
    let acc = byStore.get(storeId);
    if (!acc) {
      const conf = conferences.get(storeId);
      acc = {
        storeId,
        storeName: storeName.get(storeId) ?? "Loja",
        products: 0,
        purchasedValue: 0,
        share: 0,
        conference: { state: conf?.status ?? "NONE", totalItems: conf?.totalItems ?? 0, verifiedItems: conf?.verifiedItems ?? 0 },
        receivedValue: null,
        difference: null,
        differencePercent: null,
        missingCost: 0,
        suppliers: [],
        productIds: new Set(),
        supplierMap: new Map(),
      };
      byStore.set(storeId, acc);
    }
    return acc;
  };

  for (const ref of sources.referenceOrders) if (ref.cycleDate === cycleDate) ensure(ref.storeId);

  const missingCostKeys = new Set<string>();
  const allProducts = new Set<string>();
  const allSuppliers = new Set<string>();
  for (const alloc of sources.allocations) {
    if (alloc.cycleDate !== cycleDate || !(alloc.destinedQuantity > 0)) continue;
    const acc = ensure(alloc.storeId);
    acc.productIds.add(alloc.productId);
    allProducts.add(alloc.productId);
    allSuppliers.add(alloc.supplierId);
    const cost = costs.get(alloc.productId) ?? null;
    if (cost === null) missingCostKeys.add(`${alloc.storeId}|${alloc.productId}`);
    const value = cost === null ? 0 : alloc.destinedQuantity * cost;
    const finalized = acc.conference.state === "FINALIZED";
    const received = finalized ? value * receivedRatio(lineByKey.get(`${alloc.storeId}|${alloc.productId}`)) : 0;

    const supplier = acc.supplierMap.get(alloc.supplierId) ?? {
      supplierId: alloc.supplierId,
      supplierName: alloc.supplierName,
      invoices: invoices.get(`${alloc.storeId}|${alloc.supplierId}`) ?? [],
      products: 0,
      purchasedValue: 0,
      receivedValue: finalized ? 0 : null,
      difference: null,
      productIds: new Set<string>(),
    };
    supplier.productIds.add(alloc.productId);
    supplier.purchasedValue += value;
    if (supplier.receivedValue !== null) supplier.receivedValue += received;
    acc.supplierMap.set(alloc.supplierId, supplier);
    acc.purchasedValue += value;
    if (finalized) acc.receivedValue = (acc.receivedValue ?? 0) + received;
  }
  for (const key of missingCostKeys) byStore.get(key.split("|")[0])!.missingCost += 1;

  const totalPurchased = round2([...byStore.values()].reduce((sum, s) => sum + s.purchasedValue, 0));
  let receivedTotal = 0;
  let purchasedOfFinalized = 0;
  let storesFinalized = 0;
  const stores: StoreValue[] = [...byStore.values()]
    .map((acc) => {
      const purchasedValue = round2(acc.purchasedValue);
      const finalized = acc.conference.state === "FINALIZED";
      const receivedValue = finalized ? round2(acc.receivedValue ?? 0) : null;
      if (finalized) {
        storesFinalized += 1;
        receivedTotal += receivedValue ?? 0;
        purchasedOfFinalized += purchasedValue;
      }
      const difference = receivedValue === null ? null : round2(receivedValue - purchasedValue);
      const suppliers = [...acc.supplierMap.values()]
        .map(({ productIds, ...s }) => {
          const purchased = round2(s.purchasedValue);
          const received = s.receivedValue === null ? null : round2(s.receivedValue);
          return {
            ...s,
            products: productIds.size,
            purchasedValue: purchased,
            receivedValue: received,
            difference: received === null ? null : round2(received - purchased),
          };
        })
        .sort((a, b) => b.purchasedValue - a.purchasedValue || a.supplierName.localeCompare(b.supplierName, "pt-BR"));
      return {
        storeId: acc.storeId,
        storeName: acc.storeName,
        products: acc.productIds.size,
        purchasedValue,
        share: totalPurchased > 0 ? Math.round((purchasedValue / totalPurchased) * 1000) / 10 : 0,
        conference: acc.conference,
        receivedValue,
        difference,
        differencePercent:
          difference === null || purchasedValue <= 0 ? null : Math.round((difference / purchasedValue) * 1000) / 10,
        missingCost: acc.missingCost,
        suppliers,
      };
    })
    .sort((a, b) => a.storeName.localeCompare(b.storeName, "pt-BR"));

  const difference = round2(receivedTotal - purchasedOfFinalized);
  return {
    stores,
    totals: {
      purchasedValue: totalPurchased,
      products: allProducts.size,
      suppliers: allSuppliers.size,
      storesFinalized,
      receivedValue: round2(receivedTotal),
      purchasedOfFinalized: round2(purchasedOfFinalized),
      difference,
      differencePercent: purchasedOfFinalized > 0 ? Math.round((difference / purchasedOfFinalized) * 1000) / 10 : null,
      missingCost: missingCostKeys.size,
    },
  };
}

// ---------------------------------------------------------------------------
// Ciclo e filtros da URL
// ---------------------------------------------------------------------------

export type ClosingTab = "produtos" | "valores";

export type ClosingSearchParams = {
  ciclo?: string;
  aba?: string;
  loja?: string;
  busca?: string;
  desfecho?: string;
};

export type ClosingFilters = {
  cycleDate: string | null;
  tab: ClosingTab;
  storeId?: string;
  search?: string;
  filter?: JourneyFilter;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Ciclo pedido na URL, ou o mais recente até hoje; sem ciclos, null. */
export function resolveCycle(requested: string | undefined, cycles: readonly string[], today: string): string | null {
  if (requested && ISO_DATE.test(requested) && !Number.isNaN(Date.parse(`${requested}T00:00:00Z`))) return requested;
  return cycles.find((c) => c <= today) ?? cycles[cycles.length - 1] ?? null;
}

export function resolveClosingFilters(params: ClosingSearchParams, cycles: readonly string[], today: string): ClosingFilters {
  const filter = (JOURNEY_FILTERS as readonly string[]).includes(params.desfecho ?? "")
    ? (params.desfecho as JourneyFilter)
    : undefined;
  return {
    cycleDate: resolveCycle(params.ciclo?.trim(), cycles, today),
    tab: params.aba === "valores" ? "valores" : "produtos",
    storeId: params.loja?.trim() || undefined,
    search: params.busca?.trim() || undefined,
    filter,
  };
}

/** Vizinhos na lista de ciclos (que vem do mais recente para o mais antigo). */
export function neighborCycles(cycles: readonly string[], cycleDate: string | null) {
  if (!cycleDate) return { previousCycle: null, nextCycle: null };
  const older = cycles.filter((c) => c < cycleDate);
  const newer = cycles.filter((c) => c > cycleDate);
  return { previousCycle: older[0] ?? null, nextCycle: newer[newer.length - 1] ?? null };
}

