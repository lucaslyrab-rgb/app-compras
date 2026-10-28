"use client";

import { useActionState, useMemo, useState } from "react";
import { ProductPhoto } from "@/components/product-photo";
import { StoreNavigation } from "@/components/store-navigation";
import {
  STANDARD_LOSS_REASONS,
  aggregateLossTotals,
  type LossReason,
  type StoreLossRecord,
} from "./domain";
import { recordStoreLossAction, cancelStoreLossAction, type LossActionState } from "./actions";

type ProductOption = {
  id: string;
  erpCode: number;
  name: string;
  unit: string;
  purchaseFormat?: string | null;
  photoKey?: string | null;
  photoUpdatedAt?: string | null;
};

export function StoreLossWorkspace({
  storeId,
  storeName,
  products,
  initialLosses,
  hasOrderPermission,
  hasConferencePermission,
}: {
  storeId: string;
  storeName: string;
  products: ProductOption[];
  initialLosses: StoreLossRecord[];
  hasOrderPermission: boolean;
  hasConferencePermission: boolean;
}) {
  const [losses, setLosses] = useState<StoreLossRecord[]>(initialLosses);
  const [syncedInitialLosses, setSyncedInitialLosses] = useState(initialLosses);
  if (initialLosses !== syncedInitialLosses) {
    setSyncedInitialLosses(initialLosses);
    setLosses(initialLosses);
  }

  const [selectedProductId, setSelectedProductId] = useState<string>(products[0]?.id ?? "");
  const [productSearch, setProductSearch] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState<"KG" | "UND">("KG");
  const [reason, setReason] = useState<LossReason>("Maduro / Passado");
  const [notes, setNotes] = useState("");

  const [recordState, recordAction, isRecording] = useActionState(recordStoreLossAction, {});
  const [cancelState, cancelAction, isCancelling] = useActionState(cancelStoreLossAction, {});

  // Rastreia qual das duas ações (registrar/excluir) foi disparada mais recentemente,
  // em vez de dar prioridade permanente a cancelState sempre que ele tiver mensagem.
  const [feedback, setFeedback] = useState<LossActionState>({});
  const [syncedRecordState, setSyncedRecordState] = useState(recordState);
  if (recordState !== syncedRecordState) {
    setSyncedRecordState(recordState);
    setFeedback(recordState);
  }
  const [syncedCancelState, setSyncedCancelState] = useState(cancelState);
  if (cancelState !== syncedCancelState) {
    setSyncedCancelState(cancelState);
    setFeedback(cancelState);
  }

  // Totalizadores de hoje
  const totals = useMemo(() => {
    return aggregateLossTotals(losses);
  }, [losses]);

  // Produto atualmente selecionado
  const selectedProduct = useMemo(() => {
    return products.find((p) => p.id === selectedProductId) ?? null;
  }, [products, selectedProductId]);

  // Produtos filtrados na busca
  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return products.slice(0, 50);
    return products
      .filter((p) => p.name.toLowerCase().includes(q) || String(p.erpCode).includes(q))
      .slice(0, 50);
  }, [products, productSearch]);

  const [syncedFilteredProducts, setSyncedFilteredProducts] = useState(filteredProducts);
  if (filteredProducts !== syncedFilteredProducts) {
    setSyncedFilteredProducts(filteredProducts);
    if (!filteredProducts.some((p) => p.id === selectedProductId)) {
      setSelectedProductId(filteredProducts[0]?.id ?? "");
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", paddingBottom: 60 }}>
      <StoreNavigation
        storeName={storeName}
        hasOrderPermission={hasOrderPermission}
        hasConferencePermission={hasConferencePermission}
        hasLossPermission
      />

      <main style={{ maxWidth: 800, margin: "0 auto", padding: "16px 12px" }}>
        {/* Banner do Módulo */}
        <div style={{ marginBottom: 14 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: "#0f172a" }}>
            Lançamento de Perdas e Descartes
          </h2>
          <p style={{ fontSize: 13, color: "#64748b", margin: "2px 0 0" }}>
            Registre as quebras do dia para controle e auditoria do hortifrúti.
          </p>
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

        {/* Card Formulário de Registro de Perda */}
        <div
          style={{
            background: "#ffffff",
            borderRadius: 12,
            padding: 16,
            border: "1px solid #e2e8f0",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            marginBottom: 20,
          }}
        >
          <h3 style={{ fontSize: 15, fontWeight: 800, color: "#004737", margin: "0 0 12px" }}>
            + Registrar Nova Perda
          </h3>

          <form action={recordAction}>
            <input type="hidden" name="storeId" value={storeId} />
            <input type="hidden" name="productId" value={selectedProductId} />
            <input type="hidden" name="unit" value={unit} />
            <input type="hidden" name="reason" value={reason} />

            {/* Seleção do Produto com Foto */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 6 }}>
                PRODUTO:
              </label>

              {/* Pré-visualização do produto selecionado */}
              {selectedProduct && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "8px 12px",
                    background: "#f1f5f9",
                    borderRadius: 8,
                    marginBottom: 8,
                  }}
                >
                  <ProductPhoto
                    productId={selectedProduct.id}
                    name={selectedProduct.name}
                    photoKey={selectedProduct.photoKey}
                    photoUpdatedAt={selectedProduct.photoUpdatedAt}
                    size="md"
                  />
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 14, color: "#0f172a" }}>
                      [{selectedProduct.erpCode}] {selectedProduct.name}
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>
                      Padrão de compra: {selectedProduct.purchaseFormat || selectedProduct.unit}
                    </div>
                  </div>
                </div>
              )}

              {/* Busca instantânea por ERP/Nome */}
              <input
                type="search"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="🔍 Buscar produto por nome ou código ERP..."
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  fontSize: 13,
                  marginBottom: 6,
                }}
              />

              {/* Seletor dropdown */}
              <select
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  fontSize: 14,
                  fontWeight: 600,
                  background: "#ffffff",
                }}
              >
                {filteredProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    [{p.erpCode}] {p.name} ({p.unit})
                  </option>
                ))}
              </select>
            </div>

            {/* Quantidade e Unidade */}
            <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
              <div style={{ flex: 2 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                  QUANTIDADE:
                </label>
                <input
                  type="text"
                  name="quantity"
                  inputMode="decimal"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="Ex: 4.50"
                  required
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "1px solid #cbd5e1",
                    fontSize: 16,
                    fontWeight: 800,
                  }}
                />
              </div>

              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                  UNIDADE:
                </label>
                <div style={{ display: "flex", gap: 4 }}>
                  {(["KG", "UND"] as const).map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => setUnit(u)}
                      style={{
                        flex: 1,
                        padding: "10px 0",
                        borderRadius: 8,
                        fontSize: 13,
                        fontWeight: 800,
                        border: unit === u ? "2px solid #004737" : "1px solid #cbd5e1",
                        background: unit === u ? "#004737" : "#ffffff",
                        color: unit === u ? "#ffffff" : "#475569",
                        cursor: "pointer",
                      }}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Motivo da Perda (Tags Rápidas) */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 6 }}>
                MOTIVO DO DESCARTE:
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {STANDARD_LOSS_REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setReason(r)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 20,
                      fontSize: 12,
                      fontWeight: reason === r ? 800 : 600,
                      border: reason === r ? "1px solid #004737" : "1px solid #cbd5e1",
                      background: reason === r ? "#ecfdf5" : "#ffffff",
                      color: reason === r ? "#006b4f" : "#475569",
                      cursor: "pointer",
                    }}
                  >
                    {reason === r ? "✓ " : ""}
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/* Observação Opcional */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                OBSERVAÇÃO (OPCIONAL):
              </label>
              <input
                type="text"
                name="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ex: frutos amassados no fundo da caixa..."
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  fontSize: 13,
                }}
              />
            </div>

            {/* Botão de Gravar */}
            <button
              type="submit"
              disabled={isRecording || !quantity.trim()}
              className="btn"
              style={{
                width: "100%",
                minHeight: 46,
                fontSize: 14,
                fontWeight: 800,
                background: "#004737",
                cursor: isRecording ? "wait" : "pointer",
              }}
            >
              {isRecording ? "Registrando perda..." : "+ Confirmar e Salvar Perda"}
            </button>
          </form>
        </div>

        {/* Feed de Perdas de Hoje com Fotos */}
        <div
          style={{
            background: "#ffffff",
            borderRadius: 12,
            padding: 16,
            border: "1px solid #e2e8f0",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ fontSize: 15, fontWeight: 800, margin: 0, color: "#0f172a" }}>
              Perdas de Hoje nesta Loja
            </h3>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#006b4f" }}>
              {losses.length} lançamentos ({totals.formatted})
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {losses.length === 0 ? (
              <p style={{ textAlign: "center", color: "#64748b", fontSize: 13, padding: 24, margin: 0 }}>
                Nenhuma perda registrada hoje nesta loja.
              </p>
            ) : (
              losses.map((loss) => (
                <div
                  key={loss.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 12px",
                    background: "#f8fafc",
                    borderRadius: 8,
                    border: "1px solid #e2e8f0",
                    borderLeft: "4px solid #ef4444",
                    gap: 10,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <ProductPhoto
                      productId={loss.productId}
                      name={loss.productName}
                      photoKey={loss.photoKey}
                      photoUpdatedAt={loss.photoUpdatedAt}
                      size="sm"
                    />

                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 13, color: "#0f172a" }}>
                        [{loss.erpCode}] {loss.productName}
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b" }}>
                        {loss.reason} •{" "}
                        {new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(
                          new Date(loss.recordedAt)
                        )}
                        {loss.recordedByName ? ` • Por: ${loss.recordedByName}` : ""}
                      </div>
                      {loss.notes && (
                        <div style={{ fontSize: 11, color: "#475569", fontStyle: "italic", marginTop: 2 }}>
                          Obs: {loss.notes}
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 900, color: "#991b1b" }}>
                      - {Number(loss.quantity).toFixed(2)} {loss.unit}
                    </div>

                    <form action={cancelAction} style={{ marginTop: 2 }}>
                      <input type="hidden" name="storeId" value={storeId} />
                      <input type="hidden" name="lossId" value={loss.id} />
                      <button
                        type="submit"
                        disabled={isCancelling}
                        onClick={(e) => {
                          if (!confirm(`Excluir lançamento de perda de ${loss.productName}?`)) {
                            e.preventDefault();
                          }
                        }}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#ef4444",
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: "pointer",
                          padding: "2px 4px",
                        }}
                      >
                        ✕ Excluir
                      </button>
                    </form>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Rodapé Totalizador com Trilha de Auditoria */}
          {losses.length > 0 && (
            <div
              style={{
                marginTop: 14,
                padding: "10px 14px",
                background: "#f1f5f9",
                borderRadius: 8,
                border: "1px solid #cbd5e1",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#475569" }}>TOTAL DESPERDÍCIO HOJE</div>
                <div style={{ fontSize: 14, fontWeight: 900, color: "#991b1b" }}>
                  {totals.formatted} descartados
                </div>
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#006b4f" }}>
                Auditoria ativa ✓
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
