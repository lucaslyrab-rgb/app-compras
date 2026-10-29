/**
 * Fechamento integrado (Fase 6) — regras puras do confronto
 * pedido (CX) × destinação (CX) × conferência (KG).
 *
 * Tudo aqui é calculado a partir dos registros originais e nada é gravado.
 * Situações e destaques são apenas informativos: não bloqueiam fechamento,
 * não exigem justificativa e não alteram pedidos, destinações ou conferências.
 */

/** Faixa de pesagem: até 5% para mais ou para menos é variação normal. */
export const WEIGHT_RANGE_PERCENT = 5;
/** Período máximo de consulta, em dias, entre o ciclo inicial e o final. */
export const MAX_RANGE_DAYS = 31;
/** Período padrão: hoje e os 6 dias anteriores. */
export const DEFAULT_RANGE_DAYS = 7;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 1000;

export type CutSituation = "INTEGRAL" | "PARTIAL_CUT" | "TOTAL_CUT" | "ADDITIONAL" | "NOT_COMPARABLE" | "NONE";

export const CUT_SITUATIONS = ["INTEGRAL", "PARTIAL_CUT", "TOTAL_CUT", "ADDITIONAL"] as const;

export const CUT_SITUATION_LABELS: Record<CutSituation, string> = {
  INTEGRAL: "Integral",
  PARTIAL_CUT: "Corte parcial",
  TOTAL_CUT: "Corte total",
  ADDITIONAL: "Adicional",
  NOT_COMPARABLE: "Unidades diferentes",
  NONE: "—",
};

export type WeightRange = "OK" | "SLIGHTLY_BELOW" | "OUT_OF_RANGE";

export type Highlight =
  | "WEIGHT_OUT_OF_RANGE"
  | "NOT_RECEIVED"
  | "RECEIVED_NOT_DESTINED"
  | "DESTINED_OUT_OF_CONFERENCE"
  | "CONFERENCE_PENDING";

export const HIGHLIGHTS: readonly Highlight[] = [
  "WEIGHT_OUT_OF_RANGE",
  "NOT_RECEIVED",
  "RECEIVED_NOT_DESTINED",
  "DESTINED_OUT_OF_CONFERENCE",
  "CONFERENCE_PENDING",
] as const;

/** Destaques que pedem atenção. Conferência pendente é só contexto. */
export const ATTENTION_HIGHLIGHTS: readonly Highlight[] = [
  "WEIGHT_OUT_OF_RANGE",
  "NOT_RECEIVED",
  "RECEIVED_NOT_DESTINED",
  "DESTINED_OUT_OF_CONFERENCE",
] as const;

export const HIGHLIGHT_LABELS: Record<Highlight, string> = {
  WEIGHT_OUT_OF_RANGE: "Pesagem fora da faixa",
  NOT_RECEIVED: "Não recebido",
  RECEIVED_NOT_DESTINED: "Recebido sem destinação",
  DESTINED_OUT_OF_CONFERENCE: "Fora da conferência",
  CONFERENCE_PENDING: "Conferência pendente",
};

// ---------------------------------------------------------------------------
// Dados de origem (exatamente como vêm do banco, já convertidos para número)
// ---------------------------------------------------------------------------

export type SourceStore = { id: string; name: string };

export type SourceProduct = {
  id: string;
  erpCode: number;
  name: string;
  purchaseFormat: string | null;
  saleUnit: string | null;
  conversionQuantity: number | null;
};

export type SourceReferenceOrder = {
  cycleDate: string;
  storeId: string;
  orderId: string;
  revision: number;
  /** CLOSURE: revisão do fechamento vigente da loja. LATEST: maior revisão não cancelada. */
  source: "CLOSURE" | "LATEST";
};

export type SourceOrderItem = { cycleDate: string; storeId: string; productId: string; quantity: number };

export type SourceAllocation = {
  cycleDate: string;
  storeId: string;
  productId: string;
  supplierId: string;
  supplierName: string;
  destinedQuantity: number;
  purchaseFormat: string;
  isAdditionalPurchase: boolean;
  conversionFactorKg: number | null;
};

export type SourceNotPurchased = { cycleDate: string; storeId: string; productId: string };

export type SourceConference = {
  cycleDate: string;
  storeId: string;
  status: "IN_PROGRESS" | "FINALIZED" | "CANCELLED";
  orderRevision: number | null;
};

export type SourceConferenceItem = {
  cycleDate: string;
  storeId: string;
  productId: string;
  receivedWeightKg: number | null;
  isUnreceived: boolean;
  removedFromOrder: boolean;
};

export type ReconciliationSources = {
  stores: SourceStore[];
  products: SourceProduct[];
  referenceOrders: SourceReferenceOrder[];
  orderItems: SourceOrderItem[];
  allocations: SourceAllocation[];
  notPurchased: SourceNotPurchased[];
  conferences: SourceConference[];
  conferenceItems: SourceConferenceItem[];
};

// ---------------------------------------------------------------------------
// Linha do confronto
// ---------------------------------------------------------------------------

export type DestinationGroup = { unit: string; quantity: number; suppliers: string[]; supplierIds: string[] };

export type ExpectedWeight =
  | { kg: number; source: "DESTINATION_FACTOR" | "CURRENT_PRODUCT" | "DESTINED_IN_KG" }
  | { kg: null; reason: "NO_DESTINATION" | "NO_KG_CONVERSION" | "MISSING_FACTOR" };

export type ConferenceState = "NONE" | "IN_PROGRESS" | "FINALIZED" | "CANCELLED";

export type ReconciliationLine = {
  key: string;
  cycleDate: string;
  storeId: string;
  storeName: string;
  productId: string;
  erpCode: number;
  productName: string;
  order: {
    quantity: number;
    unit: string;
    revision: number;
    source: "CLOSURE" | "LATEST";
    /** true quando a unidade veio do cadastro atual (não havia destinação para copiar). */
    unitFromCurrentProduct: boolean;
  } | null;
  destinations: DestinationGroup[];
  destinedPositive: boolean;
  notPurchased: boolean;
  cut: { situation: CutSituation; difference: number | null; unit: string | null };
  expected: ExpectedWeight;
  conference: {
    state: ConferenceState;
    revision: number | null;
    revisionDiffers: boolean;
    item: { weightKg: number | null; isUnreceived: boolean; removedFromOrder: boolean } | null;
  };
  weight: { differenceKg: number; differencePercent: number; range: WeightRange } | null;
  highlights: Highlight[];
};

// ---------------------------------------------------------------------------
// Helpers numéricos e de unidade
// ---------------------------------------------------------------------------

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function round1(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

const UNIT_SYNONYMS: Record<string, string> = {
  KG: "KG",
  KGS: "KG",
  KILO: "KG",
  KILOS: "KG",
  QUILO: "KG",
  QUILOS: "KG",
  UN: "UN",
  UND: "UN",
  UNID: "UN",
  UNIDADE: "UN",
  CX: "CX",
  CAIXA: "CX",
};

/** Normaliza a grafia da unidade. Não aplica nenhum fator de conversão. */
export function normalizeUnit(unit: string | null | undefined): string {
  const cleaned = (unit ?? "").trim().toUpperCase();
  return UNIT_SYNONYMS[cleaned] ?? cleaned;
}

/** Agrupa destinações por formato, somando apenas quantidades de mesma unidade. */
export function groupDestinations(allocations: readonly SourceAllocation[]): DestinationGroup[] {
  const groups = new Map<string, DestinationGroup>();
  for (const alloc of allocations) {
    if (!(alloc.destinedQuantity > 0)) continue;
    const unit = normalizeUnit(alloc.purchaseFormat);
    const group = groups.get(unit) ?? { unit, quantity: 0, suppliers: [], supplierIds: [] };
    group.quantity = round2(group.quantity + alloc.destinedQuantity);
    if (!group.supplierIds.includes(alloc.supplierId)) {
      group.supplierIds.push(alloc.supplierId);
      group.suppliers.push(alloc.supplierName);
    }
    groups.set(unit, group);
  }
  return [...groups.values()].sort((a, b) => a.unit.localeCompare(b.unit));
}

/**
 * Situação pedido × destinação, com o mesmo vocabulário da Conferência Conjunta dos Cortes.
 * Compara apenas na mesma unidade.
 */
export function cutSituation(
  orderQuantity: number | null,
  orderUnit: string | null,
  destinations: readonly DestinationGroup[],
): { situation: CutSituation; difference: number | null; unit: string | null } {
  const ordered = orderQuantity !== null && orderQuantity > 0 ? orderQuantity : 0;
  const totalDestinedGroups = destinations.filter((d) => d.quantity > 0);

  if (ordered === 0 && totalDestinedGroups.length === 0) {
    return { situation: "NONE", difference: null, unit: null };
  }
  if (ordered === 0) {
    const unit = totalDestinedGroups.length === 1 ? totalDestinedGroups[0].unit : null;
    const difference = totalDestinedGroups.length === 1 ? totalDestinedGroups[0].quantity : null;
    return { situation: "ADDITIONAL", difference, unit };
  }
  const unit = normalizeUnit(orderUnit);
  if (totalDestinedGroups.length === 0) {
    return { situation: "TOTAL_CUT", difference: round2(-ordered), unit };
  }
  if (totalDestinedGroups.length > 1 || totalDestinedGroups[0].unit !== unit) {
    return { situation: "NOT_COMPARABLE", difference: null, unit: null };
  }
  const destined = totalDestinedGroups[0].quantity;
  const difference = round2(destined - ordered);
  if (difference === 0) return { situation: "INTEGRAL", difference: 0, unit };
  if (difference < 0) return { situation: "PARTIAL_CUT", difference, unit };
  return { situation: "ADDITIONAL", difference, unit };
}

/**
 * Peso esperado = quantidade destinada × fator de conversão em kg.
 * Usa o fator copiado na destinação; na falta dele, a conversão atual do cadastro.
 * Só vale para produtos com unidade de venda em KG (ou destinação já em KG).
 */
export function expectedWeight(
  allocations: readonly SourceAllocation[],
  product: Pick<SourceProduct, "saleUnit" | "conversionQuantity">,
): ExpectedWeight {
  const positive = allocations.filter((a) => a.destinedQuantity > 0);
  if (positive.length === 0) return { kg: null, reason: "NO_DESTINATION" };

  const saleUnitIsKg = normalizeUnit(product.saleUnit) === "KG";
  let total = 0;
  let usedCurrentProduct = false;
  let allInKg = true;

  for (const alloc of positive) {
    if (normalizeUnit(alloc.purchaseFormat) === "KG") {
      total += alloc.destinedQuantity;
      continue;
    }
    allInKg = false;
    if (!saleUnitIsKg) return { kg: null, reason: "NO_KG_CONVERSION" };
    let factor = alloc.conversionFactorKg;
    if (factor === null || !(factor > 0)) {
      factor = product.conversionQuantity;
      usedCurrentProduct = true;
    }
    if (factor === null || !(factor > 0)) return { kg: null, reason: "MISSING_FACTOR" };
    total += alloc.destinedQuantity * factor;
  }

  const kg = round2(total);
  if (allInKg) return { kg, source: "DESTINED_IN_KG" };
  return { kg, source: usedCurrentProduct ? "CURRENT_PRODUCT" : "DESTINATION_FACTOR" };
}

/**
 * Faixa de cor da pesagem:
 * - verde (OK): 0% a +5%
 * - laranja (SLIGHTLY_BELOW): −5% até 0%
 * - vermelho (OUT_OF_RANGE): mais de 5% para mais ou para menos
 */
export function weightRange(expectedKg: number, receivedKg: number): {
  differenceKg: number;
  differencePercent: number;
  range: WeightRange;
} {
  const differenceKg = round2(receivedKg - expectedKg);
  const rawPercent = expectedKg > 0 ? ((receivedKg - expectedKg) / expectedKg) * 100 : 0;
  const differencePercent = round1(rawPercent);
  // Compara em centavos de kg para evitar erro de ponto flutuante exatamente no limite de 5%.
  const diffCents = Math.round((receivedKg - expectedKg) * 100);
  const limitCents = (expectedKg * 100 * WEIGHT_RANGE_PERCENT) / 100;
  let range: WeightRange;
  if (Math.abs(diffCents) > limitCents + 1e-9) range = "OUT_OF_RANGE";
  else if (diffCents >= 0) range = "OK";
  else range = "SLIGHTLY_BELOW";
  return { differenceKg, differencePercent, range };
}

export function classifyReconciliationLine(line: Omit<ReconciliationLine, "highlights" | "weight">): {
  weight: ReconciliationLine["weight"];
  highlights: Highlight[];
} {
  const highlights: Highlight[] = [];
  const item = line.conference.item;
  const state = line.conference.state;
  const activeConference = state === "IN_PROGRESS" || state === "FINALIZED";

  let weight: ReconciliationLine["weight"] = null;
  if (
    line.expected.kg !== null &&
    line.expected.kg > 0 &&
    item &&
    !item.isUnreceived &&
    item.weightKg !== null &&
    item.weightKg > 0
  ) {
    weight = weightRange(line.expected.kg, item.weightKg);
    if (weight.range === "OUT_OF_RANGE") highlights.push("WEIGHT_OUT_OF_RANGE");
  }

  if (item?.isUnreceived && line.destinedPositive) highlights.push("NOT_RECEIVED");
  if (item && !item.isUnreceived && (item.weightKg ?? 0) > 0 && !line.destinedPositive) {
    highlights.push("RECEIVED_NOT_DESTINED");
  }
  if (line.destinedPositive && activeConference && !item) highlights.push("DESTINED_OUT_OF_CONFERENCE");
  if (line.destinedPositive && state !== "FINALIZED") highlights.push("CONFERENCE_PENDING");

  return { weight, highlights };
}

export function hasAttention(line: Pick<ReconciliationLine, "highlights">): boolean {
  return line.highlights.some((h) => ATTENTION_HIGHLIGHTS.includes(h));
}

// ---------------------------------------------------------------------------
// Montagem das linhas
// ---------------------------------------------------------------------------

function pairKey(cycleDate: string, storeId: string) {
  return `${cycleDate}|${storeId}`;
}

function lineKey(cycleDate: string, storeId: string, productId: string) {
  return `${cycleDate}|${storeId}|${productId}`;
}

export function buildReconciliationLines(sources: ReconciliationSources): ReconciliationLine[] {
  const storeNames = new Map(sources.stores.map((s) => [s.id, s.name]));
  const products = new Map(sources.products.map((p) => [p.id, p]));
  const refOrders = new Map(sources.referenceOrders.map((o) => [pairKey(o.cycleDate, o.storeId), o]));
  const conferences = new Map(sources.conferences.map((c) => [pairKey(c.cycleDate, c.storeId), c]));

  const orderItems = new Map<string, SourceOrderItem>();
  for (const item of sources.orderItems) {
    if (item.quantity > 0) orderItems.set(lineKey(item.cycleDate, item.storeId, item.productId), item);
  }
  const allocations = new Map<string, SourceAllocation[]>();
  for (const alloc of sources.allocations) {
    const key = lineKey(alloc.cycleDate, alloc.storeId, alloc.productId);
    const list = allocations.get(key) ?? [];
    list.push(alloc);
    allocations.set(key, list);
  }
  const notPurchased = new Set(sources.notPurchased.map((d) => lineKey(d.cycleDate, d.storeId, d.productId)));
  const confItems = new Map(
    sources.conferenceItems.map((i) => [lineKey(i.cycleDate, i.storeId, i.productId), i]),
  );

  const keys = new Set<string>();
  for (const key of orderItems.keys()) keys.add(key);
  for (const [key, list] of allocations) if (list.some((a) => a.destinedQuantity > 0)) keys.add(key);
  for (const [key, item] of confItems) {
    const conf = conferences.get(pairKey(item.cycleDate, item.storeId));
    if (conf && conf.status !== "CANCELLED") keys.add(key);
  }

  const lines: ReconciliationLine[] = [];
  for (const key of keys) {
    const [cycleDate, storeId, productId] = key.split("|");
    const product = products.get(productId);
    if (!product) continue;

    const ref = refOrders.get(pairKey(cycleDate, storeId)) ?? null;
    const orderItem = orderItems.get(key) ?? null;
    const lineAllocs = allocations.get(key) ?? [];
    const destinations = groupDestinations(lineAllocs);
    const destinedPositive = destinations.length > 0;

    const allocationUnit = lineAllocs.find((a) => a.purchaseFormat)?.purchaseFormat ?? null;
    const order =
      orderItem && ref
        ? {
            quantity: round2(orderItem.quantity),
            unit: normalizeUnit(allocationUnit ?? product.purchaseFormat ?? "CX"),
            revision: ref.revision,
            source: ref.source,
            unitFromCurrentProduct: allocationUnit === null,
          }
        : null;

    const conf = conferences.get(pairKey(cycleDate, storeId)) ?? null;
    const state: ConferenceState = conf ? conf.status : "NONE";
    const rawItem = state === "IN_PROGRESS" || state === "FINALIZED" ? confItems.get(key) ?? null : null;
    const conference = {
      state,
      revision: conf?.orderRevision ?? null,
      revisionDiffers: Boolean(
        conf && ref && conf.orderRevision !== null && conf.orderRevision !== ref.revision,
      ),
      item: rawItem
        ? {
            weightKg: rawItem.receivedWeightKg,
            isUnreceived: rawItem.isUnreceived,
            removedFromOrder: rawItem.removedFromOrder,
          }
        : null,
    };

    const base = {
      key,
      cycleDate,
      storeId,
      storeName: storeNames.get(storeId) ?? "Loja",
      productId,
      erpCode: product.erpCode,
      productName: product.name,
      order,
      destinations,
      destinedPositive,
      notPurchased: notPurchased.has(key),
      cut: cutSituation(order?.quantity ?? null, order?.unit ?? null, destinations),
      expected: expectedWeight(lineAllocs, product),
      conference,
    };
    const { weight, highlights } = classifyReconciliationLine(base);
    lines.push({ ...base, weight, highlights });
  }

  return lines.sort(
    (a, b) =>
      b.cycleDate.localeCompare(a.cycleDate) ||
      a.storeName.localeCompare(b.storeName, "pt-BR") ||
      Number(hasAttention(b)) - Number(hasAttention(a)) ||
      a.productName.localeCompare(b.productName, "pt-BR"),
  );
}

// ---------------------------------------------------------------------------
// Filtros e indicadores
// ---------------------------------------------------------------------------

export type ReconciliationFilters = {
  storeId?: string;
  startDate: string;
  endDate: string;
  supplierId?: string;
  search?: string;
  situation?: (typeof CUT_SITUATIONS)[number];
  highlight?: Highlight;
  onlyAttention: boolean;
};

export class ReconciliationFilterError extends Error {
  override name = "ReconciliationFilterError";
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(value: string): number | null {
  if (!ISO_DATE.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString().slice(0, 10) === value ? time : null;
}

export function shiftIsoDate(isoDate: string, days: number): string {
  const time = Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000;
  return new Date(time).toISOString().slice(0, 10);
}

/** Valida e completa os filtros recebidos da URL. `today` vem do fuso operacional. */
export function resolveFilters(
  raw: {
    storeId?: string;
    startDate?: string;
    endDate?: string;
    supplierId?: string;
    search?: string;
    situation?: string;
    highlight?: string;
    onlyAttention?: string;
  },
  today: string,
): ReconciliationFilters {
  const endDate = raw.endDate?.trim() || today;
  const startDate = raw.startDate?.trim() || shiftIsoDate(endDate, -(DEFAULT_RANGE_DAYS - 1));
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (start === null || end === null) {
    throw new ReconciliationFilterError("Informe datas válidas para o ciclo inicial e final.");
  }
  if (end < start) {
    throw new ReconciliationFilterError("O ciclo final não pode ser anterior ao ciclo inicial.");
  }
  if ((end - start) / 86_400_000 > MAX_RANGE_DAYS) {
    throw new ReconciliationFilterError(`O período máximo de consulta é de ${MAX_RANGE_DAYS} dias.`);
  }
  const situation = (CUT_SITUATIONS as readonly string[]).includes(raw.situation ?? "")
    ? (raw.situation as ReconciliationFilters["situation"])
    : undefined;
  const highlight = (HIGHLIGHTS as readonly string[]).includes(raw.highlight ?? "")
    ? (raw.highlight as Highlight)
    : undefined;
  return {
    storeId: raw.storeId?.trim() || undefined,
    startDate,
    endDate,
    supplierId: raw.supplierId?.trim() || undefined,
    search: raw.search?.trim() || undefined,
    situation,
    highlight,
    onlyAttention: raw.onlyAttention !== "0",
  };
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Filtros aplicados sobre as linhas já montadas. Loja e período são aplicados
 * antes, na leitura do banco.
 */
export function filterLines(
  lines: readonly ReconciliationLine[],
  filters: Pick<ReconciliationFilters, "search" | "situation" | "highlight" | "onlyAttention" | "supplierId">,
): ReconciliationLine[] {
  const search = filters.search ? normalizeSearch(filters.search) : null;
  return lines.filter((line) => {
    // Com um destaque escolhido, ele manda: "somente com destaque" não esconde a conferência pendente.
    if (filters.onlyAttention && !filters.highlight && !hasAttention(line)) return false;
    if (filters.situation && line.cut.situation !== filters.situation) return false;
    if (filters.highlight && !line.highlights.includes(filters.highlight)) return false;
    const supplierId = filters.supplierId;
    if (supplierId && !line.destinations.some((d) => d.supplierIds.includes(supplierId))) return false;
    if (search) {
      const haystack = normalizeSearch(`${line.erpCode} ${line.productName}`);
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

export type ReconciliationKpis = {
  totalLines: number;
  attentionLines: number;
  weightOk: number;
  weightSlightlyBelow: number;
  weightOutOfRange: number;
  notReceived: number;
  receivedNotDestined: number;
  outOfConference: number;
  /** Pares ciclo × loja com destinação e conferência não finalizada. */
  pendingConferences: number;
};

export function buildKpis(lines: readonly ReconciliationLine[]): ReconciliationKpis {
  const pendingPairs = new Set<string>();
  const kpis: ReconciliationKpis = {
    totalLines: lines.length,
    attentionLines: 0,
    weightOk: 0,
    weightSlightlyBelow: 0,
    weightOutOfRange: 0,
    notReceived: 0,
    receivedNotDestined: 0,
    outOfConference: 0,
    pendingConferences: 0,
  };
  for (const line of lines) {
    if (hasAttention(line)) kpis.attentionLines += 1;
    if (line.weight?.range === "OK") kpis.weightOk += 1;
    if (line.weight?.range === "SLIGHTLY_BELOW") kpis.weightSlightlyBelow += 1;
    if (line.weight?.range === "OUT_OF_RANGE") kpis.weightOutOfRange += 1;
    if (line.highlights.includes("NOT_RECEIVED")) kpis.notReceived += 1;
    if (line.highlights.includes("RECEIVED_NOT_DESTINED")) kpis.receivedNotDestined += 1;
    if (line.highlights.includes("DESTINED_OUT_OF_CONFERENCE")) kpis.outOfConference += 1;
    if (line.highlights.includes("CONFERENCE_PENDING")) pendingPairs.add(pairKey(line.cycleDate, line.storeId));
  }
  kpis.pendingConferences = pendingPairs.size;
  return kpis;
}

/** Mensagem explicativa da pesagem vermelha. */
export function weightMessage(weight: NonNullable<ReconciliationLine["weight"]>): string | null {
  if (weight.range !== "OUT_OF_RANGE") return null;
  const pct = Math.abs(weight.differencePercent).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const kg = Math.abs(weight.differenceKg).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return weight.differenceKg < 0
    ? `Pesagem ${pct}% abaixo do esperado (−${kg} kg)`
    : `Pesagem ${pct}% acima do esperado (+${kg} kg)`;
}
