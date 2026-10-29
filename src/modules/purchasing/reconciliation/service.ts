import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  ReconciliationFilterError,
  buildKpis,
  buildReconciliationLines,
  filterLines,
  resolveFilters,
  type ReconciliationFilters,
  type ReconciliationKpis,
  type ReconciliationLine,
} from "./domain";
import { loadReconciliationSources } from "./repository";

export type ReconciliationSearchParams = {
  storeId?: string;
  startDate?: string;
  endDate?: string;
  supplierId?: string;
  search?: string;
  situation?: string;
  highlight?: string;
  onlyAttention?: string;
  limit?: string;
};

export type ReconciliationResult =
  | {
      ok: true;
      filters: ReconciliationFilters;
      kpis: ReconciliationKpis;
      lines: ReconciliationLine[];
      totalMatching: number;
      pageSize: number;
      suppliers: { id: string; name: string }[];
    }
  | { ok: false; error: string; filters: Partial<ReconciliationFilters> };

/** Data de hoje no fuso operacional da MultiShow. */
export function operationalToday(now = new Date(), timeZone = "America/Sao_Paulo"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function resolvePageSize(raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.floor(value), MAX_PAGE_SIZE);
}

/**
 * Monta o Fechamento integrado: valida filtros, lê as fontes do período,
 * aplica as regras puras e calcula os indicadores sobre TODO o filtro
 * (nunca só sobre a página exibida).
 */
export async function getReconciliation(
  params: ReconciliationSearchParams,
  today = operationalToday(),
): Promise<ReconciliationResult> {
  let filters: ReconciliationFilters;
  try {
    filters = resolveFilters(params, today);
  } catch (error) {
    if (error instanceof ReconciliationFilterError) {
      return {
        ok: false,
        error: error.message,
        filters: { startDate: params.startDate, endDate: params.endDate, storeId: params.storeId },
      };
    }
    throw error;
  }

  const sources = await loadReconciliationSources({
    startDate: filters.startDate,
    endDate: filters.endDate,
    storeId: filters.storeId,
  });

  const suppliers = [
    ...new Map(sources.allocations.map((a) => [a.supplierId, { id: a.supplierId, name: a.supplierName }])).values(),
  ].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const allLines = buildReconciliationLines(sources);
  const matching = filterLines(allLines, filters);
  const pageSize = resolvePageSize(params.limit);

  return {
    ok: true,
    filters,
    kpis: buildKpis(filterLines(allLines, { ...filters, onlyAttention: false, highlight: undefined })),
    lines: matching.slice(0, pageSize),
    totalMatching: matching.length,
    pageSize,
    suppliers,
  };
}
