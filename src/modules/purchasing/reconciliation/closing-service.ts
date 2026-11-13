import {
  buildProductJourneys,
  buildStoreValues,
  countInvoices,
  filterJourneys,
  neighborCycles,
  resolveClosingFilters,
  summarizeJourneys,
  type ClosingFilters,
  type ClosingSearchParams,
  type JourneySummary,
  type ProductJourney,
  type StoreValuesResult,
} from "./closing";
import { buildReconciliationLines } from "./domain";
import { listClosingCycles, loadReconciliationSources } from "./repository";
import { operationalToday } from "./service";

export type { ClosingFilters, ClosingSearchParams, ClosingTab } from "./closing";
export { neighborCycles, resolveClosingFilters, resolveCycle } from "./closing";

export type ClosingOverview = {
  filters: ClosingFilters;
  cycles: string[];
  previousCycle: string | null;
  nextCycle: string | null;
  summary: JourneySummary | null;
  journeys: ProductJourney[];
  values: StoreValuesResult | null;
};

export async function getClosingOverview(
  params: ClosingSearchParams,
  today = operationalToday(),
): Promise<ClosingOverview> {
  const cycles = await listClosingCycles();
  const filters = resolveClosingFilters(params, cycles, today);
  const { previousCycle, nextCycle } = neighborCycles(cycles, filters.cycleDate);
  if (!filters.cycleDate) {
    return { filters, cycles, previousCycle, nextCycle, summary: null, journeys: [], values: null };
  }

  // Lê todas as lojas: "foi destinado" e "foi comprado" valem para o ciclo inteiro.
  const sources = await loadReconciliationSources({ startDate: filters.cycleDate, endDate: filters.cycleDate });
  const lines = buildReconciliationLines(sources);
  const all = buildProductJourneys(sources, lines, { cycleDate: filters.cycleDate, storeId: filters.storeId });

  return {
    filters,
    cycles,
    previousCycle,
    nextCycle,
    summary: summarizeJourneys(all, countInvoices(sources, filters.cycleDate, filters.storeId)),
    journeys: filterJourneys(all, { filter: filters.filter, search: filters.search }),
    values: buildStoreValues(sources, lines, filters.cycleDate),
  };
}
