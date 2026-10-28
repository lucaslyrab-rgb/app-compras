"use client";

import { useActionState, useMemo, useRef, useState, type MouseEvent } from "react";
import { ProductPhoto } from "@/components/product-photo";
import { StoreNavigation } from "@/components/store-navigation";
import { ConferenceCycleSelector } from "./conference-cycle-selector";
import {
  calculateConferenceProgress,
  getItemStatus,
  type ConferenceHeader,
  type ConferenceItem,
  type ConferenceOrderSyncStatus,
} from "./domain";
import {
  saveConferenceDraftAction,
  finalizeConferenceAction,
  reconcileConferenceAction,
  cancelConferenceAction,
  type ConferenceActionState,
  type ConferenceReconcileState,
} from "./actions";

type FilterType = "ALL" | "PENDING" | "VERIFIED";

function serializeItemsPayload(items: ConferenceItem[]): string {
  return JSON.stringify(
    items.map((it) => ({
      productId: it.productId,
      receivedWeightKg: it.isUnreceived ? 0 : it.receivedWeightKg,
      isUnreceived: it.isUnreceived,
    }))
  );
}

function buildEditingWeights(items: ConferenceItem[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const it of items) {
    if (it.receivedWeightKg !== null) map[it.productId] = String(it.receivedWeightKg);
  }
  return map;
}

export function ConferenceWorkspace({
  header,
  initialItems,
  cycles,
  hasOrderPermission,
  hasLossPermission,
}: {
  header: ConferenceHeader;
  initialItems: ConferenceItem[];
  cycles: string[];
  hasOrderPermission: boolean;
  hasLossPermission: boolean;
}) {
  const [items, setItems] = useState<ConferenceItem[]>(initialItems);
  const [filter, setFilter] = useState<FilterType>("ALL");
  const [query, setQuery] = useState("");
  const [editingWeights, setEditingWeights] = useState<Record<string, string>>(() => buildEditingWeights(initialItems));

  const itemsJsonPayload = useMemo(() => serializeItemsPayload(items), [items]);

  // Rastreia o último payload confirmado como persistido no servidor (carga
  // inicial, um Salvar Parcial com sucesso, ou o resultado de uma reconciliação/
  // cancelamento). Pesagens digitadas que ainda não foram salvas tornam
  // itemsJsonPayload diferente de lastSavedPayload - usado para não deixar
  // Sincronizar/Cancelar descartar peso não salvo sem confirmação explícita.
  const [lastSavedPayload, setLastSavedPayload] = useState(itemsJsonPayload);
  const hasUnsavedChanges = itemsJsonPayload !== lastSavedPayload;

  // Guarda o payload exatamente como foi enviado no submit mais recente de
  // Salvar/Finalizar - não o valor atual de itemsJsonPayload, que pode já ter
  // mudado (o operador pode continuar digitando enquanto a resposta não chega).
  // Sem isso, uma resposta de sucesso marcaria como "salvo" um conteúdo que na
  // verdade nunca foi enviado ao servidor.
  const submittedPayloadRef = useRef(itemsJsonPayload);
  function captureSubmittedPayload() {
    submittedPayloadRef.current = itemsJsonPayload;
  }

  const [saveState, saveAction, isSaving] = useActionState(saveConferenceDraftAction, {});
  const [finalizeState, finalizeAction, isFinalizing] = useActionState(finalizeConferenceAction, {});
  const [reconcileState, reconcileAction, isReconciling] = useActionState(reconcileConferenceAction, {});
  const [cancelState, cancelAction, isCancelling] = useActionState(cancelConferenceAction, {});

  // Ratchet: só avança para uma versão mais nova após uma gravação confirmada pelo
  // servidor; nunca regride para a versão inicial do carregamento em caso de erro.
  const [version, setVersion] = useState(header.version);
  const [syncedSaveState, setSyncedSaveState] = useState(saveState);
  if (saveState !== syncedSaveState) {
    setSyncedSaveState(saveState);
    if (saveState.status === "success" && typeof saveState.version === "number") {
      setVersion(saveState.version);
      setLastSavedPayload(submittedPayloadRef.current);
    }
  }
  const [syncedFinalizeStateForSavedPayload, setSyncedFinalizeStateForSavedPayload] = useState(finalizeState);
  if (finalizeState !== syncedFinalizeStateForSavedPayload) {
    setSyncedFinalizeStateForSavedPayload(finalizeState);
    if (finalizeState.status === "success") {
      setLastSavedPayload(submittedPayloadRef.current);
    }
  }

  // orderSyncStatus reflete o header mais recente recebido do servidor (a cada
  // revalidação da página - salvar, finalizar, ou só reabrir), preservando os
  // campos que o operador está editando (items/editingWeights não são tocados
  // aqui). Sem isso, uma divergência detectada pelo servidor depois da primeira
  // montagem só apareceria num recarregamento completo da página.
  const [orderSyncStatus, setOrderSyncStatus] = useState<ConferenceOrderSyncStatus>(header.orderSyncStatus);
  const [syncedHeaderForOrderStatus, setSyncedHeaderForOrderStatus] = useState(header);
  if (header !== syncedHeaderForOrderStatus) {
    setSyncedHeaderForOrderStatus(header);
    setOrderSyncStatus(header.orderSyncStatus);
  }

  // Aplica o resultado da reconciliação/cancelamento: itens/pesagens e versão
  // atualizados vêm do servidor; nada é recalculado no cliente para evitar
  // divergência. O payload resultante já é considerado "salvo".
  const [syncedReconcileState, setSyncedReconcileState] = useState(reconcileState);
  if (reconcileState !== syncedReconcileState) {
    setSyncedReconcileState(reconcileState);
    if (reconcileState.status === "success" && reconcileState.header && reconcileState.items) {
      setItems(reconcileState.items);
      setEditingWeights(buildEditingWeights(reconcileState.items));
      setVersion(reconcileState.header.version);
      setOrderSyncStatus(reconcileState.header.orderSyncStatus);
      setLastSavedPayload(serializeItemsPayload(reconcileState.items));
    }
  }
  const [syncedCancelState, setSyncedCancelState] = useState(cancelState);
  if (cancelState !== syncedCancelState) {
    setSyncedCancelState(cancelState);
    if (cancelState.status === "success" && cancelState.header && cancelState.items) {
      setItems(cancelState.items);
      setEditingWeights(buildEditingWeights(cancelState.items));
      setVersion(cancelState.header.version);
      setOrderSyncStatus(cancelState.header.orderSyncStatus);
      setLastSavedPayload(serializeItemsPayload(cancelState.items));
    }
  }

  // Rastreia qual das quatro ações foi disparada mais recentemente, em vez de
  // dar prioridade permanente a uma delas sempre que tiver mensagem (o que
  // esconderia o resultado de uma ação seguinte).
  const [feedback, setFeedback] = useState<ConferenceActionState | ConferenceReconcileState>({});
  const [syncedFeedbackSaveState, setSyncedFeedbackSaveState] = useState(saveState);
  if (saveState !== syncedFeedbackSaveState) {
    setSyncedFeedbackSaveState(saveState);
    setFeedback(saveState);
  }
  const [syncedFinalizeState, setSyncedFinalizeState] = useState(finalizeState);
  if (finalizeState !== syncedFinalizeState) {
    setSyncedFinalizeState(finalizeState);
    setFeedback(finalizeState);
  }
  const [syncedFeedbackReconcileState, setSyncedFeedbackReconcileState] = useState(reconcileState);
  if (reconcileState !== syncedFeedbackReconcileState) {
    setSyncedFeedbackReconcileState(reconcileState);
    setFeedback(reconcileState);
  }
  const [syncedFeedbackCancelState, setSyncedFeedbackCancelState] = useState(cancelState);
  if (cancelState !== syncedFeedbackCancelState) {
    setSyncedFeedbackCancelState(cancelState);
    setFeedback(cancelState);
  }

  const isClosed = header.status === "FINALIZED" || header.status === "CANCELLED";
  const isSyncing = isReconciling || isCancelling;

  // Progresso em tempo real
  const progress = useMemo(() => {
    return calculateConferenceProgress(items);
  }, [items]);

  // Filtro e busca
  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      const matchQuery =
        !q ||
        item.productName.toLowerCase().includes(q) ||
        String(item.erpCode).includes(q);

      if (!matchQuery) return false;

      const status = getItemStatus(item);
      if (filter === "PENDING") return status === "PENDING";
      if (filter === "VERIFIED") return status === "RECEIVED" || status === "UNRECEIVED";
      return true;
    });
  }, [items, filter, query]);

  function handleWeightChange(productId: string, val: string) {
    setEditingWeights((prev) => ({ ...prev, [productId]: val }));
    const num = Number(val.replace(",", "."));
    setItems((prev) =>
      prev.map((it) => {
        if (it.productId !== productId) return it;
        if (val.trim() === "" || Number.isNaN(num) || num <= 0) {
          return { ...it, receivedWeightKg: null, isUnreceived: false };
        }
        return { ...it, receivedWeightKg: num, isUnreceived: false };
      })
    );
  }

  function handleMarkUnreceived(productId: string) {
    setEditingWeights((prev) => ({ ...prev, [productId]: "0" }));
    setItems((prev) =>
      prev.map((it) => {
        if (it.productId !== productId) return it;
        return { ...it, receivedWeightKg: 0, isUnreceived: true };
      })
    );
  }

  function handleClearWeight(productId: string) {
    setEditingWeights((prev) => ({ ...prev, [productId]: "" }));
    setItems((prev) =>
      prev.map((it) => {
        if (it.productId !== productId) return it;
        return { ...it, receivedWeightKg: null, isUnreceived: false };
      })
    );
  }

  function confirmDiscardIfDirty(event: MouseEvent<HTMLButtonElement>) {
    if (
      hasUnsavedChanges &&
      !confirm(
        "Existem pesagens digitadas nesta tela que ainda não foram salvas. Elas serão substituídas pelos dados do servidor. Descartar as alterações não salvas e continuar?"
      )
    ) {
      event.preventDefault();
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", paddingBottom: 100 }}>
      <StoreNavigation
        storeName={header.storeName}
        hasOrderPermission={hasOrderPermission}
        hasConferencePermission
        hasLossPermission={hasLossPermission}
      />

      <main style={{ maxWidth: 800, margin: "0 auto", padding: "16px 12px" }}>
        <ConferenceCycleSelector cycleDate={header.purchaseCycleDate} cycles={cycles} />

        {orderSyncStatus === "REVISED" && (
          <div
            role="alert"
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              marginBottom: 14,
              fontSize: 13,
              fontWeight: 700,
              background: "#fef3c7",
              color: "#92400e",
              border: "1px solid #f59e0b",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <span>
              ⚠️ O pedido desta loja foi revisado depois que esta conferência foi iniciada.
              A finalização fica bloqueada até sincronizar com o pedido vigente.
            </span>
            <form action={reconcileAction}>
              <input type="hidden" name="storeId" value={header.storeId} />
              <input type="hidden" name="conferenceId" value={header.id} />
              <button
                type="submit"
                disabled={isSyncing}
                onClick={confirmDiscardIfDirty}
                className="btn"
                style={{ fontSize: 12, padding: "6px 14px", minHeight: 36, borderRadius: 6, fontWeight: 800, background: "#92400e", alignSelf: "flex-start" }}
              >
                {isReconciling ? "Sincronizando..." : "🔄 Sincronizar com pedido vigente"}
              </button>
            </form>
            <span style={{ fontWeight: 500, fontSize: 12 }}>
              Pesagens já registradas para produtos que continuam no pedido são preservadas;
              produtos retirados ficam marcados no histórico, nunca apagados.
              {hasUnsavedChanges && " Pesagens digitadas aqui e ainda não salvas serão descartadas ao sincronizar."}
            </span>
          </div>
        )}

        {orderSyncStatus === "CANCELLED_WITHOUT_REPLACEMENT" && (
          <div
            role="alert"
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              marginBottom: 14,
              fontSize: 13,
              fontWeight: 700,
              background: "#fee2e2",
              color: "#991b1b",
              border: "1px solid #f87171",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <span>
              ⚠️ O pedido desta loja foi cancelado e não há nenhuma revisão substituta para este
              ciclo. Não há o que conferir; esta conferência deve ser cancelada.
            </span>
            <form action={cancelAction}>
              <input type="hidden" name="storeId" value={header.storeId} />
              <input type="hidden" name="conferenceId" value={header.id} />
              <button
                type="submit"
                disabled={isSyncing}
                onClick={confirmDiscardIfDirty}
                className="btn"
                style={{ fontSize: 12, padding: "6px 14px", minHeight: 36, borderRadius: 6, fontWeight: 800, background: "#991b1b", alignSelf: "flex-start" }}
              >
                {isCancelling ? "Cancelando..." : "✕ Cancelar esta conferência"}
              </button>
            </form>
            <span style={{ fontWeight: 500, fontSize: 12 }}>
              O cancelamento é auditado e preserva o histórico; nenhuma pesagem já registrada é apagada.
              {hasUnsavedChanges && " Pesagens digitadas aqui e ainda não salvas serão descartadas ao cancelar."}
            </span>
          </div>
        )}

        {/* Banner do Ciclo e Progresso */}
        <div
          style={{
            background: "#ffffff",
            borderRadius: 12,
            padding: 16,
            border: "1px solid #e2e8f0",
            marginBottom: 14,
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
            <div>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  padding: "3px 8px",
                  borderRadius: 4,
                  background: header.status === "FINALIZED" ? "#dcfce7" : header.status === "CANCELLED" ? "#fee2e2" : "#e0f2fe",
                  color: header.status === "FINALIZED" ? "#166534" : header.status === "CANCELLED" ? "#991b1b" : "#0369a1",
                  letterSpacing: "0.5px",
                }}
              >
                {header.status === "FINALIZED" ? "CONFERÊNCIA FINALIZADA" : header.status === "CANCELLED" ? "CONFERÊNCIA CANCELADA" : "EM ANDAMENTO"}
              </span>
              <h2 style={{ fontSize: 18, fontWeight: 800, margin: "6px 0 2px", color: "#0f172a" }}>
                Ciclo {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(`${header.purchaseCycleDate}T12:00:00`))} • Chegada
              </h2>
              <p style={{ fontSize: 12, color: "#64748b", margin: 0 }}>
                {progress.verified} de {progress.total} itens conferidos ({progress.pending} pendentes de peso)
              </p>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 24, fontWeight: 900, color: progress.percent === 100 ? "#006b4f" : "#0284c7" }}>
                {progress.percent}%
              </div>
            </div>
          </div>

          {/* Barra de Progresso */}
          <div style={{ height: 8, background: "#f1f5f9", borderRadius: 4, overflow: "hidden", marginTop: 12 }}>
            <div
              style={{
                width: `${progress.percent}%`,
                height: "100%",
                background: progress.percent === 100 ? "#006b4f" : "#0284c7",
                transition: "width 0.3s ease",
              }}
            />
          </div>
        </div>

        {/* Feedback flutuante */}
        {feedback.message && (
          <div
            role="status"
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              marginBottom: 14,
              fontSize: 13,
              fontWeight: 600,
              background: feedback.status === "error" ? "#fee2e2" : "#dcfce7",
              color: feedback.status === "error" ? "#991b1b" : "#166534",
              border: feedback.status === "error" ? "1px solid #f87171" : "1px solid #86efac",
            }}
          >
            {feedback.message}
          </div>
        )}

        {/* Barra de Filtros e Busca */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
          <div style={{ display: "flex", gap: 6 }}>
            {(
              [
                { id: "ALL", label: `Todos (${items.length})` },
                { id: "PENDING", label: `⏳ Pendentes (${progress.pending})` },
                { id: "VERIFIED", label: `✓ Conferidos (${progress.verified})` },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                style={{
                  flex: 1,
                  padding: "8px 6px",
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: filter === f.id ? 800 : 600,
                  background: filter === f.id ? "#004737" : "#ffffff",
                  color: filter === f.id ? "#ffffff" : "#475569",
                  border: filter === f.id ? "1px solid #004737" : "1px solid #cbd5e1",
                  cursor: "pointer",
                }}
              >
                {f.label}
              </button>
            ))}
          </div>

          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="🔍 Buscar produto por nome ou ERP..."
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              fontSize: 14,
              width: "100%",
              background: "#ffffff",
            }}
          />
        </div>

        {/* Lista de Itens para Conferência */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {visibleItems.length === 0 ? (
            <div style={{ textAlign: "center", padding: 32, color: "#64748b", background: "#ffffff", borderRadius: 10 }}>
              Nenhum item corresponde ao filtro ou busca selecionada.
            </div>
          ) : (
            visibleItems.map((item) => {
              const status = getItemStatus(item);
              const isChecked = status === "RECEIVED" || status === "UNRECEIVED";

              return (
                <div
                  key={item.productId}
                  style={{
                    background: "#ffffff",
                    borderRadius: 10,
                    padding: "12px 14px",
                    border: isChecked ? "1px solid #86efac" : "1px solid #e2e8f0",
                    borderLeft: isChecked
                      ? status === "RECEIVED"
                        ? "5px solid #006b4f"
                        : "5px solid #64748b"
                      : "5px solid #f59e0b",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <ProductPhoto
                      productId={item.productId}
                      name={item.productName}
                      photoKey={item.photoKey}
                      photoUpdatedAt={item.photoUpdatedAt}
                      size="md"
                    />

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
                        <div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>
                            [{item.erpCode}]
                          </span>{" "}
                          <span style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>
                            {item.productName}
                          </span>
                        </div>

                        {/* Badge de Status do Item */}
                        {status === "PENDING" && (
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#d97706", background: "#fef3c7", padding: "2px 6px", borderRadius: 4, whiteSpace: "nowrap" }}>
                            ⏳ Pendente
                          </span>
                        )}
                        {status === "RECEIVED" && (
                          <span style={{ fontSize: 11, fontWeight: 800, color: "#166534", background: "#dcfce7", padding: "2px 6px", borderRadius: 4, whiteSpace: "nowrap" }}>
                            ✓ {Number(item.receivedWeightKg).toFixed(2)} KG
                          </span>
                        )}
                        {status === "UNRECEIVED" && (
                          <span style={{ fontSize: 11, fontWeight: 800, color: "#475569", background: "#f1f5f9", padding: "2px 6px", borderRadius: 4, whiteSpace: "nowrap" }}>
                            ✕ Não Recebido (0)
                          </span>
                        )}
                      </div>

                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                        Pedido original: <strong>{Number(item.orderedQuantity).toFixed(2)} {item.orderedUnit}</strong>
                      </div>

                      {/* Controles de Pesagem / Ações */}
                      {!isClosed && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={editingWeights[item.productId] ?? ""}
                              onChange={(e) => handleWeightChange(item.productId, e.target.value)}
                              placeholder="Peso real..."
                              disabled={item.isUnreceived || isSyncing}
                              style={{
                                width: 105,
                                padding: "6px 8px",
                                fontSize: 14,
                                fontWeight: 700,
                                borderRadius: 6,
                                border: "1px solid #cbd5e1",
                                textAlign: "right",
                                background: item.isUnreceived ? "#f1f5f9" : "#ffffff",
                              }}
                            />
                            <span style={{ fontSize: 12, fontWeight: 800, color: "#475569" }}>KG</span>
                          </div>

                          {!item.isUnreceived ? (
                            <button
                              type="button"
                              onClick={() => handleMarkUnreceived(item.productId)}
                              disabled={isSyncing}
                              className="btn btn--secondary"
                              style={{
                                fontSize: 11,
                                padding: "6px 10px",
                                minHeight: 34,
                                borderRadius: 6,
                                color: "#dc2626",
                                borderColor: "#fca5a5",
                                background: "#fff",
                                fontWeight: 700,
                              }}
                            >
                              ✕ Não Recebido (0 KG)
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleClearWeight(item.productId)}
                              disabled={isSyncing}
                              className="btn btn--secondary"
                              style={{
                                fontSize: 11,
                                padding: "6px 10px",
                                minHeight: 34,
                                borderRadius: 6,
                                fontWeight: 700,
                              }}
                            >
                              ✏️ Pesar Novamente
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </main>

      {/* Barra de Ações Fixa no Rodapé (Mobile Sticky) */}
      {!isClosed && (
        <footer
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            background: "#ffffff",
            borderTop: "1px solid #cbd5e1",
            padding: "10px 16px",
            boxShadow: "0 -4px 6px -1px rgba(0, 0, 0, 0.05)",
            zIndex: 100,
          }}
        >
          <div style={{ maxWidth: 800, margin: "0 auto", display: "flex", gap: 10 }}>
            {/* Form de Salvar Parcial */}
            <form action={saveAction} onSubmit={captureSubmittedPayload} style={{ flex: 1 }}>
              <input type="hidden" name="storeId" value={header.storeId} />
              <input type="hidden" name="conferenceId" value={header.id} />
              <input type="hidden" name="version" value={version} />
              <input type="hidden" name="items" value={itemsJsonPayload} />
              <button
                type="submit"
                disabled={isSaving || isFinalizing || isSyncing}
                className="btn btn--secondary"
                style={{ width: "100%", minHeight: 44, fontSize: 13, fontWeight: 700 }}
              >
                {isSaving ? "Salvando..." : "💾 Salvar Parcial"}
              </button>
            </form>

            {/* Form de Finalizar */}
            <form action={finalizeAction} onSubmit={captureSubmittedPayload} style={{ flex: 1 }}>
              <input type="hidden" name="storeId" value={header.storeId} />
              <input type="hidden" name="conferenceId" value={header.id} />
              <input type="hidden" name="version" value={version} />
              <input type="hidden" name="items" value={itemsJsonPayload} />
              <button
                type="submit"
                disabled={isSaving || isFinalizing || isSyncing || progress.pending > 0 || orderSyncStatus !== "SYNCED"}
                className="btn"
                style={{
                  width: "100%",
                  minHeight: 44,
                  fontSize: 13,
                  fontWeight: 800,
                  background: progress.pending > 0 || orderSyncStatus !== "SYNCED" ? "#94a3b8" : "#004737",
                  cursor: progress.pending > 0 || orderSyncStatus !== "SYNCED" ? "not-allowed" : "pointer",
                }}
              >
                {isFinalizing
                  ? "Finalizando..."
                  : orderSyncStatus !== "SYNCED"
                  ? "Pedido desatualizado"
                  : progress.pending > 0
                  ? `Finalizar (${progress.pending} pendentes)`
                  : "✓ Finalizar Conferência"}
              </button>
            </form>
          </div>
        </footer>
      )}
    </div>
  );
}
