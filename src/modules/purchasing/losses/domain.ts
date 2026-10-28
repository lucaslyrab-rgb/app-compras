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

function normalizeLossUnit(unit: string): LossUnit {
  const unitUpper = (unit || "KG").trim().toUpperCase();
  return unitUpper === "UND" || unitUpper === "UN" || unitUpper === "UNIDADE" ? "UND" : "KG";
}

type UnitRanking<TNameKey extends string> = Record<LossUnit, ({ total: number } & Record<TNameKey, string>) | null>;

function rankByUnit<TNameKey extends string>(
  losses: StoreLossRecord[],
  nameKey: TNameKey,
  getName: (loss: StoreLossRecord) => string
): UnitRanking<TNameKey> {
  const maps: Record<LossUnit, Record<string, number>> = { KG: {}, UND: {} };

  for (const l of losses) {
    const unit = normalizeLossUnit(l.unit);
    const name = getName(l) || "—";
    maps[unit][name] = (maps[unit][name] || 0) + l.quantity;
  }

  const ranking = {} as UnitRanking<TNameKey>;
  for (const unit of ALLOWED_LOSS_UNITS) {
    let topName: string | null = null;
    let maxQty = -1;
    for (const [name, qty] of Object.entries(maps[unit])) {
      if (qty > maxQty) {
        maxQty = qty;
        topName = name;
      }
    }
    ranking[unit] = topName
      ? ({ [nameKey]: topName, total: Math.round(maxQty * 100) / 100 } as { total: number } & Record<TNameKey, string>)
      : null;
  }
  return ranking;
}

export function calculateLossDashboardKpis(losses: StoreLossRecord[]): {
  totals: { kg: number; und: number; formatted: string };
  // Loja/produto com maior volume, separados por unidade: KG e UND não podem ser
  // somados ou comparados diretamente sem presumir uma conversão.
  topStoreByUnit: UnitRanking<"storeName">;
  topProductByUnit: UnitRanking<"productName">;
  totalRecords: number;
} {
  const totals = aggregateLossTotals(losses);

  return {
    totals,
    topStoreByUnit: rankByUnit(losses, "storeName", (l) => l.storeName || "Loja"),
    topProductByUnit: rankByUnit(losses, "productName", (l) => l.productName || "Produto"),
    totalRecords: losses.length,
  };
}
