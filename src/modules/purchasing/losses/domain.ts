export const STANDARD_LOSS_REASONS = [
  "Avaria no Transporte",
  "Maduro / Passado",
  "Quebra Interna / Manuseio",
  "Qualidade / Broto / Murcha",
  "Outro",
] as const;

export type LossReason = (typeof STANDARD_LOSS_REASONS)[number];

export const ALLOWED_LOSS_UNITS = ["KG", "UND"] as const;
export type LossUnit = (typeof ALLOWED_LOSS_UNITS)[number];

export type StoreLossRecord = {
  id: string;
  storeId: string;
  storeName?: string;
  productId: string;
  erpCode: number;
  productName: string;
  photoKey: string | null;
  photoUpdatedAt: string | null;
  quantity: number;
  unit: string;
  reason: string;
  notes: string | null;
  recordedAt: string;
  recordedBy: string;
  recordedByName?: string;
  cancelledAt?: string | null;
  cancelledBy?: string | null;
  cancellationReason?: string | null;
};

export class LossValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LossValidationError";
  }
}

export function parseLossQuantity(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined) {
    throw new LossValidationError("A quantidade de perda deve ser informada.");
  }
  const str = String(raw).trim().replace(",", ".");
  if (str === "") {
    throw new LossValidationError("A quantidade de perda deve ser informada.");
  }
  const num = Number(str);
  if (Number.isNaN(num) || !Number.isFinite(num)) {
    throw new LossValidationError("Quantidade de perda inválida: deve ser um número decimal válido.");
  }
  if (num <= 0) {
    throw new LossValidationError("A quantidade descartada deve ser estritamente maior que zero.");
  }
  if (num > 99999.99) {
    throw new LossValidationError("A quantidade informada excede o limite permitido (99.999,99).");
  }
  return Math.round(num * 100) / 100;
}

export function formatUnitTotals(totals: { kg: number; und: number }): string {
  const parts: string[] = [];
  if (totals.kg > 0 || totals.und === 0) {
    parts.push(`${totals.kg.toFixed(2)} KG`);
  }
  if (totals.und > 0) {
    parts.push(`${totals.und.toFixed(0)} UND`);
  }
  return parts.join(" e ");
}

export function aggregateLossTotals(losses: Array<{ quantity: number; unit: string }>): {
  kg: number;
  und: number;
  formatted: string;
} {
  let kg = 0;
  let und = 0;

  for (const l of losses) {
    const unitUpper = (l.unit || "KG").trim().toUpperCase();
    if (unitUpper === "UND" || unitUpper === "UN" || unitUpper === "UNIDADE") {
      und += l.quantity;
    } else {
      kg += l.quantity;
    }
  }

  kg = Math.round(kg * 100) / 100;
  und = Math.round(und * 100) / 100;

  return {
    kg,
    und,
    formatted: formatUnitTotals({ kg, und }),
  };
}

export function calculateLossDashboardKpis(losses: StoreLossRecord[]): {
  totals: { kg: number; und: number; formatted: string };
  topStore: { storeName: string; totalKg: number } | null;
  topProduct: { productName: string; totalKg: number } | null;
  totalRecords: number;
} {
  const totals = aggregateLossTotals(losses);

  const storeMap: Record<string, number> = {};
  const productMap: Record<string, number> = {};

  for (const l of losses) {
    const sName = l.storeName || "Loja";
    const pName = l.productName || "Produto";
    storeMap[sName] = (storeMap[sName] || 0) + l.quantity;
    productMap[pName] = (productMap[pName] || 0) + l.quantity;
  }

  let topStoreName: string | null = null;
  let maxStoreQty = -1;
  for (const [sName, qty] of Object.entries(storeMap)) {
    if (qty > maxStoreQty) {
      maxStoreQty = qty;
      topStoreName = sName;
    }
  }

  let topProdName: string | null = null;
  let maxProdQty = -1;
  for (const [pName, qty] of Object.entries(productMap)) {
    if (qty > maxProdQty) {
      maxProdQty = qty;
      topProdName = pName;
    }
  }

  return {
    totals,
    topStore: topStoreName ? { storeName: topStoreName, totalKg: Math.round(maxStoreQty * 100) / 100 } : null,
    topProduct: topProdName ? { productName: topProdName, totalKg: Math.round(maxProdQty * 100) / 100 } : null,
    totalRecords: losses.length,
  };
}
