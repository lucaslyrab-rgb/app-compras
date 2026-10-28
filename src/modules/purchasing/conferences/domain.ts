export type ConferenceItemStatus = "PENDING" | "RECEIVED" | "UNRECEIVED";

export type ConferenceItem = {
  id: string;
  conferenceId: string;
  productId: string;
  erpCode: number;
  productName: string;
  photoKey: string | null;
  photoUpdatedAt: string | null;
  orderedQuantity: number;
  orderedUnit: string;
  receivedWeightKg: number | null;
  isUnreceived: boolean;
  checkedAt: string | null;
  checkedBy: string | null;
  checkerName?: string | null;
};

/**
 * SYNCED: a conferência corresponde à revisão vigente do pedido da loja.
 * REVISED: a loja enviou uma revisão nova depois que a conferência foi criada;
 *   existe uma revisão vigente diferente da que originou a conferência -
 *   reconcileConferenceWithCurrentOrder() resolve este caso.
 * CANCELLED_WITHOUT_REPLACEMENT: a revisão que originou a conferência foi
 *   cancelada e não há nenhuma revisão vigente para substituí-la - não há
 *   pedido para conferir; cancelConferenceWithoutReplacementOrder() resolve
 *   este caso encerrando a conferência (não apaga nada).
 */
export type ConferenceOrderSyncStatus = "SYNCED" | "REVISED" | "CANCELLED_WITHOUT_REPLACEMENT";

export type ConferenceHeader = {
  id: string;
  purchaseCycleDate: string;
  storeId: string;
  storeName: string;
  orderId: string | null;
  orderRevision: number | null;
  status: "IN_PROGRESS" | "FINALIZED" | "CANCELLED";
  totalItems: number;
  verifiedItems: number;
  finalizedAt: string | null;
  finalizedBy: string | null;
  finalizerName?: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  /**
   * SYNCED enquanto a conferência está IN_PROGRESS e acompanha a revisão vigente.
   * Para conferências FINALIZED/CANCELLED (histórico encerrado) é sempre SYNCED:
   * esse status não é revalidado contra o pedido atual.
   */
  orderSyncStatus: ConferenceOrderSyncStatus;
};

export type ConferenceCycleOption = {
  cycleDate: string;
  status: "NOT_STARTED" | "IN_PROGRESS" | "FINALIZED" | "CANCELLED";
  totalItems: number;
  verifiedItems: number;
};

export class ConferenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConferenceValidationError";
  }
}

export function getItemStatus(item: {
  receivedWeightKg: number | null;
  isUnreceived: boolean;
}): ConferenceItemStatus {
  if (item.isUnreceived) return "UNRECEIVED";
  if (item.receivedWeightKg !== null && item.receivedWeightKg > 0) return "RECEIVED";
  return "PENDING";
}

export function parseWeightInput(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim().replace(",", ".");
  if (str === "") return null;
  const num = Number(str);
  if (Number.isNaN(num) || !Number.isFinite(num)) {
    throw new ConferenceValidationError("Peso inválido: deve ser um número decimal.");
  }
  return Math.round(num * 100) / 100;
}

export function validateReceivedWeight(weight: number | null): void {
  if (weight === null) return;
  if (Number.isNaN(weight) || !Number.isFinite(weight)) {
    throw new ConferenceValidationError("Peso inválido: valor numérico inválido.");
  }
  if (weight < 0) {
    throw new ConferenceValidationError("O peso recebido não pode ser negativo.");
  }
  if (weight > 99999.99) {
    throw new ConferenceValidationError("O peso recebido excede o limite máximo permitido (99.999,99 KG).");
  }
}

export function calculateConferenceProgress(items: Array<{
  receivedWeightKg: number | null;
  isUnreceived: boolean;
}>): {
  total: number;
  verified: number;
  pending: number;
  percent: number;
} {
  const total = items.length;
  let verified = 0;
  for (const it of items) {
    const status = getItemStatus(it);
    if (status === "RECEIVED" || status === "UNRECEIVED") {
      verified += 1;
    }
  }
  const pending = Math.max(0, total - verified);
  const percent = total > 0 ? Math.round((verified / total) * 100) : 100;
  return { total, verified, pending, percent };
}

export function assertCanFinalizeConference(items: Array<{
  productName?: string;
  receivedWeightKg: number | null;
  isUnreceived: boolean;
}>): void {
  const pendingItems = items.filter((it) => getItemStatus(it) === "PENDING");
  if (pendingItems.length > 0) {
    throw new ConferenceValidationError(
      `Não é possível finalizar a conferência: ainda existem ${pendingItems.length} item(ns) pendente(s) de pesagem ou confirmação de não recebido.`
    );
  }
}
