/**
 * Encerramento de ciclo pelo Gestor ("Encerrar ciclo").
 *
 * Fecha o ciclo inteiro de uma vez: a Destinação (fechamento do comprador) e as
 * conferências em andamento das lojas. Serve para ciclos antigos que ficaram
 * abertos (ex.: período de implantação/testes) e não devem mais aparecer nos
 * seletores. Nada é apagado; fica registrado quem encerrou, quando e por quê.
 */

export type ConferenceSituation = "NOT_STARTED" | "IN_PROGRESS" | "FINALIZED" | "CANCELLED";

export type CycleStoreSituation = {
  storeId: string;
  storeName: string;
  /** A loja tem pedido vigente (não cancelado) neste ciclo. */
  hasOrder: boolean;
  conference: ConferenceSituation;
  verifiedItems: number;
  totalItems: number;
};

export type OpenCycleSummary = {
  cycleDate: string;
  /** Situação da Destinação (fechamento do comprador). */
  buyerStatus: "OPEN" | "CLOSED";
  stores: CycleStoreSituation[];
};

export class CycleArchiveError extends Error {
  override name = "CycleArchiveError";
}

/** O ciclo ainda tem algo aberto: Destinação aberta ou loja com pedido sem conferência encerrada. */
export function isCycleStillOpen(summary: OpenCycleSummary): boolean {
  if (summary.buyerStatus !== "CLOSED") return true;
  return summary.stores.some(
    (s) => s.hasOrder && (s.conference === "NOT_STARTED" || s.conference === "IN_PROGRESS"),
  );
}

/** Só ciclos anteriores a hoje podem ser encerrados por aqui (evita encerrar o ciclo em operação). */
export function canArchiveCycle(cycleDate: string, today: string): boolean {
  return cycleDate < today;
}

export function parseArchiveReason(raw: unknown): string {
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (reason.length < 3) {
    throw new CycleArchiveError("Informe o motivo do encerramento (mínimo de 3 caracteres).");
  }
  if (reason.length > 300) {
    throw new CycleArchiveError("O motivo do encerramento pode ter no máximo 300 caracteres.");
  }
  return reason;
}

const CONFERENCE_LABELS: Record<ConferenceSituation, string> = {
  NOT_STARTED: "não iniciada",
  IN_PROGRESS: "em andamento",
  FINALIZED: "finalizada",
  CANCELLED: "cancelada",
};

/** Texto do que será encerrado, mostrado antes da confirmação. */
export function describeStoreSituation(store: CycleStoreSituation): string {
  if (!store.hasOrder && store.conference === "NOT_STARTED") return "sem pedido";
  const label = CONFERENCE_LABELS[store.conference];
  if (store.conference === "IN_PROGRESS") {
    return `conferência ${label} (${store.verifiedItems} de ${store.totalItems} itens)`;
  }
  return `conferência ${label}`;
}
