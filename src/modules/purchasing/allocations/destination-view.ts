/**
 * Regras de apresentação da tela de Destinação (mobile-first).
 *
 * Funções puras, sem efeitos colaterais e sem dependências de runtime, para que a
 * tela fique simples e as decisões visuais (status, pendências, ordenação) sejam
 * testáveis. Nenhuma regra de negócio de gravação mora aqui.
 */
import type {
  StoreAllocationData,
  StoreCutItem,
  StoreSummaryData,
  SupplierSummaryOption,
} from "./domain";

function toNumber(value: string | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** "5.00" → "5"; "2.50" → "2,5"; "-1.25" → "-1,25". Para leitura rápida no celular. */
export function formatQty(value: string | null | undefined): string {
  const n = Math.round(toNumber(value) * 100) / 100;
  const text = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "");
  return text.replace(".", ",");
}

export type ProductStatusKind =
  | "integral"
  | "partial"
  | "total"
  | "additional"
  | "pending"
  | "elsewhere"
  | "blocked"
  | "no-order";

export type ProductStatus = {
  kind: ProductStatusKind;
  label: string;
  /** Classe do selo global (`status-tag--*`). */
  tone: "integral" | "partial" | "total" | "additional" | "pending";
};

/**
 * Situação do produto na loja ativa, considerando a quantidade digitada (ainda que
 * não salva), o que já foi destinado em outros fornecedores e o bloqueio de custos.
 * Regra de 04/11/2026: zero neste fornecedor = não comprou dele.
 */
export function productStoreStatus(params: {
  store: Pick<StoreAllocationData, "orderedQuantity" | "destinedQuantity"> | undefined;
  unit: string;
  blockedByCosts: boolean;
  /** Já destinado para esta loja em outros fornecedores. */
  destinedInOtherSuppliers?: string | null;
}): ProductStatus {
  const ordered = toNumber(params.store?.orderedQuantity);
  const destined = toNumber(params.store?.destinedQuantity);
  const other = toNumber(params.destinedInOtherSuppliers);

  if (params.blockedByCosts) {
    return { kind: "blocked", label: "Não comprado nos custos", tone: "total" };
  }
  if (ordered === 0) {
    return destined > 0
      ? { kind: "additional", label: "Adicional", tone: "additional" }
      : { kind: "no-order", label: "Sem pedido", tone: "pending" };
  }
  if (destined === 0) {
    if (other <= 0) return { kind: "pending", label: "A destinar", tone: "pending" };
    const missing = Math.round((ordered - other) * 100) / 100;
    if (missing <= 0) return { kind: "elsewhere", label: "Em outro fornecedor", tone: "integral" };
    return { kind: "pending", label: `Falta ${formatQty(String(missing))} ${params.unit}`, tone: "partial" };
  }

  const diff = Math.round((destined + other - ordered) * 100) / 100;
  if (diff === 0) return { kind: "integral", label: "Integral", tone: "integral" };
  if (diff > 0) {
    return { kind: "additional", label: `+${formatQty(String(diff))} ${params.unit}`, tone: "additional" };
  }
  return { kind: "partial", label: `−${formatQty(String(-diff))} ${params.unit}`, tone: "partial" };
}

/**
 * Produto ainda sem nenhuma destinação GRAVADA para a loja (somando todos os
 * fornecedores). Usa o valor gravado para que o cartão não suma da lista
 * enquanto o comprador digita. "Não comprado" antigo não resolve pendência.
 */
export function isProductPending(params: {
  store: Pick<StoreAllocationData, "orderedQuantity" | "persistedDestinedQuantity"> | undefined;
  destinedInOtherSuppliers?: string | null;
  blockedByCosts: boolean;
  hasDestinedInStore: boolean;
}): boolean {
  if (params.blockedByCosts) return params.hasDestinedInStore;
  if (toNumber(params.store?.orderedQuantity) <= 0) return false;
  return toNumber(params.store?.persistedDestinedQuantity) + toNumber(params.destinedInOtherSuppliers) <= 0;
}

/** Rótulo do atalho: "Usar pedido" quando o saldo é o pedido inteiro, senão "Usar saldo". */
export function suggestionLabel(params: { orderedQuantity: string; suggestedQuantity?: string | null }): string | null {
  const suggested = toNumber(params.suggestedQuantity);
  if (suggested <= 0) return null;
  const ordered = toNumber(params.orderedQuantity);
  return `${suggested >= ordered ? "Usar pedido" : "Usar saldo"} · ${formatQty(String(suggested))}`;
}

/** Iniciais para o avatar do fornecedor ("Levi Scardua" → "LS", "Ademar" → "AD"). */
export function supplierInitials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0 && !/^(da|de|do|das|dos|e|&|-)$/i.test(word));
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * Ordem da lista de fornecedores no seletor: atual primeiro, depois os que ainda
 * não foram conferidos nesta loja, por fim os conferidos. Mantém a ordem original
 * dentro de cada grupo.
 */
export function sortSuppliersForPicker(
  suppliers: SupplierSummaryOption[],
  currentSupplierId: string | null,
  storeId: string,
): SupplierSummaryOption[] {
  const rank = (supplier: SupplierSummaryOption) => {
    if (supplier.id === currentSupplierId) return 0;
    return supplier.reviewedByStore?.[storeId] ? 2 : 1;
  };
  return suppliers
    .map((supplier, index) => ({ supplier, index }))
    .sort((a, b) => rank(a.supplier) - rank(b.supplier) || a.index - b.index)
    .map(({ supplier }) => supplier);
}

/** Filtra fornecedores por nome fantasia ou razão social, sem diferenciar acentos. */
export function filterSuppliers(
  suppliers: SupplierSummaryOption[],
  query: string,
): SupplierSummaryOption[] {
  const normalize = (text: string) =>
    text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const q = normalize(query.trim());
  if (!q) return suppliers;
  return suppliers.filter(
    (supplier) =>
      normalize(supplier.displayName).includes(q) || normalize(supplier.corporateName).includes(q),
  );
}

export type StoreProgressState = "finalized" | "stale" | "in-progress" | "not-started";

export type StoreProgress = {
  state: StoreProgressState;
  label: string;
  tone: "integral" | "partial" | "pending";
  done: number;
  total: number;
  pending: number;
  /** 0 a 100. */
  percent: number;
};

/** Progresso da loja para o cartão de escolha de loja. */
export function storeProgress(summary: StoreSummaryData | undefined): StoreProgress {
  const pending = summary?.totalPendingProducts ?? 0;
  const done = summary?.totalReviewedProducts ?? 0;
  const total = Math.max(done + pending, summary?.totalOrderedProducts ?? 0, done);
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  if (summary?.closureStatus === "CLOSED" && !summary.isStale) {
    return { state: "finalized", label: "Finalizada", tone: "integral", done, total, pending: 0, percent: 100 };
  }
  if (summary?.closureStatus === "CLOSED" && summary.isStale) {
    return { state: "stale", label: "Reconferir", tone: "partial", done, total, pending, percent };
  }
  if (done > 0 || toNumber(summary?.totalDestinedQuantity) > 0) {
    return { state: "in-progress", label: "Em andamento", tone: "partial", done, total, pending, percent };
  }
  return { state: "not-started", label: "Não iniciada", tone: "pending", done, total, pending, percent };
}

/** Separa a conferência da loja entre itens que exigem atenção e itens atendidos. */
export function splitClosureItems(cuts: StoreCutItem[]): {
  attention: StoreCutItem[];
  fulfilled: StoreCutItem[];
} {
  const attention: StoreCutItem[] = [];
  const fulfilled: StoreCutItem[] = [];
  for (const cut of cuts) {
    if (cut.status === "FULFILLED") fulfilled.push(cut);
    else attention.push(cut);
  }
  const order: Record<StoreCutItem["status"], number> = {
    TOTAL_CUT: 0,
    PARTIAL_CUT: 1,
    ADDITIONAL: 2,
    FULFILLED: 3,
  };
  attention.sort((a, b) => order[a.status] - order[b.status] || a.productName.localeCompare(b.productName, "pt-BR"));
  return { attention, fulfilled };
}

/** Selo de cada item da conferência de cortes. */
export function closureItemTag(cut: StoreCutItem): { label: string; tone: ProductStatus["tone"]; detail: string } {
  const unit = cut.purchaseFormat;
  const ordered = toNumber(cut.orderedQuantity);
  const detail =
    ordered > 0
      ? `Pedido ${formatQty(cut.orderedQuantity)} ${unit} · destinado ${formatQty(cut.destinedQuantity)}`
      : `Sem pedido · destinado ${formatQty(cut.destinedQuantity)} ${unit}`;
  switch (cut.status) {
    case "TOTAL_CUT":
      return { label: "Corte total", tone: "total", detail };
    case "PARTIAL_CUT":
      return { label: `−${formatQty(cut.cutQuantity)} ${unit}`, tone: "partial", detail };
    case "ADDITIONAL":
      return { label: "Adicional", tone: "additional", detail };
    default:
      return { label: "Integral", tone: "integral", detail };
  }
}
