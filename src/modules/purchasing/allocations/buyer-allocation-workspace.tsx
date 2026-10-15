"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { formatTaxId } from "@/modules/suppliers/domain";
import {
  closeBuyerCycleAction,
  reopenBuyerCycleAction,
  saveSupplierAllocationsAction,
} from "./actions";
import {
  calculateDifference,
  parseQuantity,
  roundToTwoDecimals,
  sumQuantities,
  type BuyerAllocationWorkspaceData,
  type CatalogSearchItem,
  type ProductAllocationItem,
  type StoreAllocationData,
} from "./domain";
import "./styles.css";

export function BuyerAllocationWorkspace({
  data,
}: {
  data: BuyerAllocationWorkspaceData;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const {
    cycleDate,
    cycles,
    selectedSupplierId,
    closure,
    suppliers,
    stores,
    destinationData,
    unassignedPurchasedProducts,
    catalogSearchList,
  } = data;

  const isClosed = closure.status === "CLOSED";

  // Estado local dos produtos do fornecedor selecionado
  const [products, setProducts] = useState<ProductAllocationItem[]>(
    destinationData?.products ?? [],
  );
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Filtro de busca na lista de produtos
  const [searchQuery, setSearchQuery] = useState("");

  // Modais
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const [showReopenModal, setShowReopenModal] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [reopenError, setReopenError] = useState<string | null>(null);

  const [showUnassignedModal, setShowUnassignedModal] = useState(false);
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [catalogSearchQuery, setCatalogSearchQuery] = useState("");

  // Atualiza quantidade destinada para uma loja em um produto
  const handleQuantityChange = (
    productId: string,
    storeId: string,
    rawVal: string,
  ) => {
    if (isClosed) return;

    setProducts((prev) =>
      prev.map((prod) => {
        if (prod.productId !== productId) return prod;

        const currentStore = prod.stores[storeId];
        if (!currentStore) return prod;

        const val = rawVal.replace(",", ".");
        const numVal = parseQuantity(val);
        const destinedQty = val === "" ? "0.00" : roundToTwoDecimals(numVal);
        const diff = calculateDifference(destinedQty, currentStore.orderedQuantity);
        const isAdditional = parseQuantity(currentStore.orderedQuantity) === 0 && parseQuantity(destinedQty) > 0;

        const updatedStores = {
          ...prod.stores,
          [storeId]: {
            ...currentStore,
            destinedQuantity: destinedQty,
            difference: diff,
            isAdditionalPurchase: isAdditional,
          },
        };

        const totalDestined = sumQuantities(
          Object.values(updatedStores).map((s) => s.destinedQuantity),
        );
        const totalDiff = calculateDifference(totalDestined, prod.totalOrdered);
        const isAdditionalOverall =
          parseQuantity(prod.totalOrdered) === 0 && parseQuantity(totalDestined) > 0;

        return {
          ...prod,
          stores: updatedStores,
          totalDestined,
          totalDifference: totalDiff,
          isAdditionalPurchase: isAdditionalOverall,
        };
      }),
    );

    setIsDirty(true);
    setSaveMessage(null);
  };

  const handleStepQuantity = (
    productId: string,
    storeId: string,
    delta: number,
  ) => {
    if (isClosed) return;

    const prod = products.find((p) => p.productId === productId);
    if (!prod) return;

    const currentStore = prod.stores[storeId];
    if (!currentStore) return;

    const currentNum = parseQuantity(currentStore.destinedQuantity);
    const newNum = Math.max(0, currentNum + delta);
    handleQuantityChange(productId, storeId, String(newNum));
  };

  // Salva destinações para o fornecedor atual
  const handleSaveAllocations = async () => {
    if (!selectedSupplierId || isClosed || saving) return;

    setSaving(true);
    setErrorMessage(null);
    setSaveMessage(null);

    try {
      const payload = {
        cycleDate,
        supplierId: selectedSupplierId,
        allocations: products.map((prod) => ({
          productId: prod.productId,
          stores: Object.values(prod.stores).map((store) => ({
            storeId: store.storeId,
            destinedQuantity: store.destinedQuantity,
            notes: store.notes ?? undefined,
          })),
        })),
      };

      const result = await saveSupplierAllocationsAction(payload);

      if (result.status === "success") {
        setIsDirty(false);
        setSaveMessage("Destinações salvas com sucesso!");
        startTransition(() => {
          router.refresh();
        });
      } else {
        setErrorMessage(result.message);
      }
    } catch {
      setErrorMessage("Erro de rede ao salvar destinações.");
    } finally {
      setSaving(false);
    }
  };

  // Adiciona produto do catálogo
  const handleAddProductFromCatalog = (item: CatalogSearchItem) => {
    if (products.some((p) => p.productId === item.id)) {
      setShowAddProductModal(false);
      return;
    }

    const newStoreAllocations: Record<string, StoreAllocationData> = {};
    for (const store of stores) {
      newStoreAllocations[store.id] = {
        storeId: store.id,
        storeName: store.name,
        storeSlug: store.slug,
        orderedQuantity: "0.00",
        destinedQuantity: "0.00",
        difference: "+0.00",
        isAdditionalPurchase: false,
      };
    }

    const newProd: ProductAllocationItem = {
      productId: item.id,
      erpCode: item.erpCode,
      productName: item.name,
      purchaseFormat: item.purchaseFormat,
      isExclusive: item.isExclusive,
      exclusiveSupplierId: item.exclusiveSupplierId,
      exclusiveSupplierName: item.exclusiveSupplierName,
      hasOfficialCost: false,
      officialCost: null,
      purchasedInCosts: false,
      isAdditionalPurchase: true,
      conversionFactorKg: null,
      conversionOrigin: null,
      stores: newStoreAllocations,
      totalOrdered: "0.00",
      totalDestined: "0.00",
      totalDifference: "+0.00",
      version: 1,
    };

    setProducts((prev) => [newProd, ...prev]);
    setIsDirty(true);
    setShowAddProductModal(false);
  };

  // Confirmação de fechamento operacional
  const handleConfirmCloseCycle = async () => {
    setClosing(true);
    setCloseError(null);

    try {
      const res = await closeBuyerCycleAction({ cycleDate });
      if (res.status === "success") {
        setShowCloseModal(false);
        startTransition(() => {
          router.refresh();
        });
      } else {
        setCloseError(res.message);
      }
    } catch {
      setCloseError("Erro de comunicação ao fechar ciclo.");
    } finally {
      setClosing(false);
    }
  };

  // Confirmação de reabertura do ciclo
  const handleConfirmReopenCycle = async () => {
    if (!reopenReason || reopenReason.trim().length < 5) {
      setReopenError("A justificativa deve ter no mínimo 5 caracteres.");
      return;
    }

    setReopening(true);
    setReopenError(null);

    try {
      const res = await reopenBuyerCycleAction({
        cycleDate,
        reason: reopenReason.trim(),
      });
      if (res.status === "success") {
        setShowReopenModal(false);
        setReopenReason("");
        startTransition(() => {
          router.refresh();
        });
      } else {
        setReopenError(res.message);
      }
    } catch {
      setReopenError("Erro de comunicação ao reabrir ciclo.");
    } finally {
      setReopening(false);
    }
  };

  // Produtos filtrados na tela atual
  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return products;
    const q = searchQuery.toLowerCase().trim();
    return products.filter(
      (p) =>
        p.productName.toLowerCase().includes(q) ||
        String(p.erpCode).includes(q),
    );
  }, [products, searchQuery]);

  // Produtos disponíveis no catálogo para adicionar
  const filteredCatalogItems = useMemo(() => {
    const existingIds = new Set(products.map((p) => p.productId));
    const list = catalogSearchList.filter((item) => !existingIds.has(item.id));
    if (!catalogSearchQuery.trim()) return list.slice(0, 50);
    const q = catalogSearchQuery.toLowerCase().trim();
    return list
      .filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          String(item.erpCode).includes(q),
      )
      .slice(0, 50);
  }, [catalogSearchList, products, catalogSearchQuery]);

  const selectedSupplier = suppliers.find((s) => s.id === selectedSupplierId);

  return (
    <div className="alloc-workspace">
      {/* BARRA SUPERIOR: TÍTULO, SELEÇÃO DE CICLO */}
      <div className="alloc-topbar">
        <div className="alloc-topbar__title">
          <h1>Destinação de Compras (Pós-Embarque)</h1>
          <p>
            Vincule os produtos aos fornecedores e ajuste as quantidades por loja
          </p>
        </div>
        <div className="alloc-topbar__controls">
          <label htmlFor="cycle-picker" className="visually-hidden">
            Ciclo de compras:
          </label>
          <select
            id="cycle-picker"
            className="alloc-select"
            value={cycleDate}
            onChange={(e) => {
              const newCycle = e.target.value;
              router.push(
                selectedSupplierId
                  ? `/comprador/destinacao?ciclo=${newCycle}&fornecedor=${selectedSupplierId}`
                  : `/comprador/destinacao?ciclo=${newCycle}`,
              );
            }}
          >
            {cycles.map((c) => (
              <option key={c} value={c}>
                Compra de {new Date(c + "T12:00:00").toLocaleDateString("pt-BR")}
              </option>
            ))}
          </select>

          {isClosed ? (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => setShowReopenModal(true)}
            >
              🔓 Reabrir Ciclo
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--success"
              onClick={() => setShowCloseModal(true)}
            >
              🔒 Fechar Ciclo Operacional
            </button>
          )}
        </div>
      </div>

      {/* BANNER DE FECHAMENTO */}
      {isClosed ? (
        <div className="alloc-banner alloc-banner--closed" role="status">
          <div className="alloc-banner__content">
            <span className="alloc-banner__icon">🔒</span>
            <div className="alloc-banner__text">
              <h3>Ciclo Operacional Fechado</h3>
              <p>
                Fechado por {closure.closedByName ?? "Comprador"} em{" "}
                {closure.closedAt
                  ? new Date(closure.closedAt).toLocaleString("pt-BR")
                  : "—"}
                . As destinações estão em modo somente leitura.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => setShowReopenModal(true)}
          >
            Reabrir Ciclo
          </button>
        </div>
      ) : (
        <div className="alloc-banner alloc-banner--open">
          <div className="alloc-banner__content">
            <span className="alloc-banner__icon">🚚</span>
            <div className="alloc-banner__text">
              <h3>Ciclo Aberto para Destinação</h3>
              <p>
                {closure.totalAllocatedProducts} produtos destinados •{" "}
                {closure.totalPurchasedInCosts} produtos marcados como comprados
              </p>
            </div>
          </div>
          {unassignedPurchasedProducts.length > 0 ? (
            <button
              type="button"
              className="btn btn--secondary"
              style={{ color: "#b45309", borderColor: "#fde68a" }}
              onClick={() => setShowUnassignedModal(true)}
            >
              ⚠️ {unassignedPurchasedProducts.length} itens sem fornecedor
            </button>
          ) : (
            <span style={{ fontSize: "13px", fontWeight: "600", color: "#15803d" }}>
              ✓ Todos os itens comprados possuem destinação
            </span>
          )}
        </div>
      )}

      {/* SELETOR DE FORNECEDOR */}
      <section className="alloc-supplier-card" aria-label="Seleção do Fornecedor">
        <div className="alloc-supplier-card__header">
          <div>
            <label
              htmlFor="supplier-selector"
              style={{ fontSize: "12px", fontWeight: "700", textTransform: "uppercase", color: "#475569" }}
            >
              Selecione o Fornecedor:
            </label>
            <div style={{ marginTop: "4px" }}>
              <select
                id="supplier-selector"
                className="alloc-select"
                style={{ minWidth: "280px", maxWidth: "100%", fontWeight: "700" }}
                value={selectedSupplierId ?? ""}
                onChange={(e) => {
                  const sId = e.target.value;
                  router.push(
                    sId
                      ? `/comprador/destinacao?ciclo=${cycleDate}&fornecedor=${sId}`
                      : `/comprador/destinacao?ciclo=${cycleDate}`,
                  );
                }}
              >
                <option value="">-- Escolha um fornecedor --</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.corporateName}{" "}
                    {s.hasAllocationsInCycle
                      ? `(${s.totalDestinedQuantity} vol)`
                      : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selectedSupplierId ? (
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <Link
                href={`/comprador/fornecedores/${selectedSupplierId}/faturamento?ciclo=${cycleDate}`}
                className="btn btn--secondary"
                target="_blank"
                rel="noopener noreferrer"
              >
                📄 Faturamento deste Fornecedor ↗
              </Link>
            </div>
          ) : null}
        </div>

        {selectedSupplier ? (
          <dl className="alloc-supplier-grid">
            <div className="alloc-supplier-item">
              <dt>Razão Social</dt>
              <dd>{selectedSupplier.corporateName}</dd>
            </div>
            {selectedSupplier.tradeName ? (
              <div className="alloc-supplier-item">
                <dt>Nome Fantasia</dt>
                <dd>{selectedSupplier.tradeName}</dd>
              </div>
            ) : null}
            <div className="alloc-supplier-item">
              <dt>Documento</dt>
              <dd>
                {selectedSupplier.taxId
                  ? formatTaxId(selectedSupplier.taxId)
                  : "Não informado"}
              </dd>
            </div>
            <div className="alloc-supplier-item">
              <dt>Status no Ciclo</dt>
              <dd>
                {selectedSupplier.hasAllocationsInCycle ? (
                  <span style={{ color: "#16a34a" }}>
                    ✓ {selectedSupplier.totalDestinedQuantity} volumes destinados
                  </span>
                ) : (
                  <span style={{ color: "#64748b" }}>Sem destinações salvas</span>
                )}
              </dd>
            </div>
          </dl>
        ) : null}
      </section>

      {/* FEEDBACK MENSAGENS */}
      {saveMessage ? (
        <div className="alloc-banner alloc-banner--closed" style={{ marginBottom: "12px" }}>
          <span>✓ {saveMessage}</span>
        </div>
      ) : null}

      {errorMessage ? (
        <div className="alloc-banner alloc-banner--warning" style={{ marginBottom: "12px" }}>
          <span>⚠️ {errorMessage}</span>
        </div>
      ) : null}

      {/* PRODUTOS DO FORNECEDOR SELECIONADO */}
      {selectedSupplierId ? (
        <section aria-label="Produtos para destinação">
          <div className="alloc-products-toolbar">
            <input
              type="search"
              className="alloc-search-input"
              placeholder="Buscar produto por nome ou código..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />

            {!isClosed ? (
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setShowAddProductModal(true)}
              >
                + Adicionar Outro Produto
              </button>
            ) : null}
          </div>

          {filteredProducts.length > 0 ? (
            <div>
              {filteredProducts.map((prod) => (
                <article key={prod.productId} className="alloc-product-card">
                  <header className="alloc-product-header">
                    <div className="alloc-product-info">
                      <div className="alloc-product-title">
                        <span className="alloc-product-erp">{prod.erpCode}</span>
                        <strong className="alloc-product-name">{prod.productName}</strong>
                        <span className="alloc-product-format">({prod.purchaseFormat})</span>
                      </div>
                      <div className="alloc-badges">
                        {prod.isExclusive ? (
                          <span className="alloc-badge alloc-badge--exclusive">
                            Exclusivo
                          </span>
                        ) : null}
                        {prod.isAdditionalPurchase ? (
                          <span className="alloc-badge alloc-badge--additional">
                            Sem pedido / Oportunidade
                          </span>
                        ) : null}
                        {!prod.hasOfficialCost ? (
                          <span className="alloc-badge alloc-badge--no-cost">
                            Sem custo oficial
                          </span>
                        ) : null}
                        {parseQuantity(prod.totalDestined) > 0 ? (
                          <span className="alloc-badge alloc-badge--allocated">
                            Destinado: {prod.totalDestined} {prod.purchaseFormat}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </header>

                  <div className="alloc-stores-list">
                    {stores.map((store) => {
                      const storeData = prod.stores[store.id] ?? {
                        storeId: store.id,
                        storeName: store.name,
                        storeSlug: store.slug,
                        orderedQuantity: "0.00",
                        destinedQuantity: "0.00",
                        difference: "+0.00",
                        isAdditionalPurchase: false,
                      };

                      const diff = storeData.difference;
                      const isSurplus = diff.startsWith("+") && diff !== "+0.00";
                      const isCut = diff.startsWith("-");

                      return (
                        <div key={store.id} className="alloc-store-row">
                          <div className="alloc-store-info">
                            <span className="alloc-store-name">
                              {store.name.replace("MultiShow ", "")}
                            </span>
                            <span className="alloc-store-order-hint">
                              Pedido: {storeData.orderedQuantity} {prod.purchaseFormat}
                            </span>
                          </div>

                          <div className="alloc-stepper">
                            <button
                              type="button"
                              className="alloc-stepper-btn"
                              disabled={isClosed}
                              aria-label={`Diminuir quantidade para ${store.name}`}
                              onClick={() => handleStepQuantity(prod.productId, store.id, -1)}
                            >
                              −
                            </button>
                            <input
                              type="number"
                              step="any"
                              min="0"
                              className="alloc-stepper-input"
                              disabled={isClosed}
                              value={storeData.destinedQuantity}
                              onChange={(e) =>
                                handleQuantityChange(prod.productId, store.id, e.target.value)
                              }
                            />
                            <button
                              type="button"
                              className="alloc-stepper-btn"
                              disabled={isClosed}
                              aria-label={`Aumentar quantidade para ${store.name}`}
                              onClick={() => handleStepQuantity(prod.productId, store.id, 1)}
                            >
                              +
                            </button>

                            <span
                              className={`alloc-diff-pill ${
                                isCut
                                  ? "alloc-diff-pill--cut"
                                  : isSurplus
                                  ? "alloc-diff-pill--surplus"
                                  : "alloc-diff-pill--neutral"
                              }`}
                              title={
                                isCut
                                  ? "Corte em relação ao pedido"
                                  : isSurplus
                                  ? "Sobra / Adicional em relação ao pedido"
                                  : "Igual ao pedido"
                              }
                            >
                              {diff}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <footer className="alloc-product-footer">
                    <div>
                      Total Pedido: <strong>{prod.totalOrdered}</strong> | Total Destinado:{" "}
                      <strong>{prod.totalDestined} {prod.purchaseFormat}</strong>
                    </div>
                    <div>
                      Diferença: <strong>{prod.totalDifference}</strong>
                    </div>
                  </footer>
                </article>
              ))}
            </div>
          ) : (
            <div
              style={{
                textAlign: "center",
                padding: "32px",
                backgroundColor: "#fff",
                borderRadius: "8px",
                border: "1px dashed #cbd5e1",
              }}
            >
              <p style={{ color: "#64748b", margin: 0 }}>
                Nenhum produto cadastrado para este fornecedor.
              </p>
              {!isClosed ? (
                <button
                  type="button"
                  className="btn btn--primary"
                  style={{ marginTop: "12px" }}
                  onClick={() => setShowAddProductModal(true)}
                >
                  + Adicionar Produto Comprado
                </button>
              ) : null}
            </div>
          )}

          {/* BARRA FIXA DE SALVAR */}
          {!isClosed ? (
            <div className="alloc-sticky-bar">
              <div className="alloc-sticky-info">
                <strong>{products.length} produtos neste fornecedor</strong>
                <span>
                  {isDirty ? "⚠️ Alterações pendentes de gravação" : "✓ Todas as alterações salvas"}
                </span>
              </div>
              <button
                type="button"
                className="btn btn--primary"
                disabled={saving || !isDirty}
                onClick={handleSaveAllocations}
              >
                {saving ? "Salvando..." : "Salvar Destinações"}
              </button>
            </div>
          ) : null}
        </section>
      ) : (
        <div
          style={{
            textAlign: "center",
            padding: "40px",
            backgroundColor: "#fff",
            borderRadius: "8px",
            border: "1px solid #e2e8f0",
          }}
        >
          <span style={{ fontSize: "36px" }}>🚚</span>
          <h2 style={{ fontSize: "16px", margin: "12px 0 4px 0" }}>
            Selecione um fornecedor para iniciar a destinação
          </h2>
          <p style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>
            Você poderá ajustar as quantidades para cada uma das 3 lojas e confirmar as compras.
          </p>
        </div>
      )}

      {/* MODAL: FECHAR CICLO OPERACIONAL */}
      {showCloseModal ? (
        <div className="alloc-modal-backdrop" role="dialog" aria-modal="true">
          <div className="alloc-modal">
            <header className="alloc-modal__header">
              <h2>Fechar Ciclo Operacional do Comprador</h2>
              <button
                type="button"
                className="btn btn--secondary"
                style={{ minHeight: "32px", padding: "4px 8px" }}
                onClick={() => setShowCloseModal(false)}
              >
                ✕
              </button>
            </header>
            <div className="alloc-modal__body">
              <p>
                O fechamento operacional consolida as compras e destinações para instrução de
                faturamento das notas fiscais e recebimento nas lojas.
              </p>

              <div
                style={{
                  backgroundColor: "#f8fafc",
                  padding: "12px",
                  borderRadius: "6px",
                  fontSize: "13px",
                }}
              >
                <div>
                  Produtos marcados como comprados:{" "}
                  <strong>{closure.totalPurchasedInCosts}</strong>
                </div>
                <div>
                  Produtos com destinação atribuída:{" "}
                  <strong>{closure.totalAllocatedProducts}</strong>
                </div>
              </div>

              {!closure.canClose ? (
                <div
                  style={{
                    backgroundColor: "#fef2f2",
                    border: "1px solid #fecaca",
                    padding: "12px",
                    borderRadius: "6px",
                    color: "#991b1b",
                  }}
                >
                  <strong>Não é possível fechar o ciclo ainda:</strong>
                  <p style={{ margin: "4px 0 8px 0", fontSize: "12px" }}>
                    Existem {closure.missingProducts.length} produto(s) marcado(s) como comprado(s)
                    nos custos que ainda não possuem fornecedor e destinação positiva atribuída:
                  </p>
                  <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "12px" }}>
                    {closure.missingProducts.map((p) => (
                      <li key={p.id}>
                        [{p.erpCode}] {p.name}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p style={{ color: "#166534", fontWeight: "600" }}>
                  ✓ Todos os produtos comprados possuem fornecedor e quantidades válidas destinadas.
                </p>
              )}

              {closeError ? (
                <div style={{ color: "#dc2626", fontSize: "13px" }}>⚠️ {closeError}</div>
              ) : null}
            </div>
            <footer className="alloc-modal__footer">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setShowCloseModal(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn--success"
                disabled={!closure.canClose || closing}
                onClick={handleConfirmCloseCycle}
              >
                {closing ? "Fechando..." : "Confirmar Fechamento"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {/* MODAL: REABRIR CICLO */}
      {showReopenModal ? (
        <div className="alloc-modal-backdrop" role="dialog" aria-modal="true">
          <div className="alloc-modal">
            <header className="alloc-modal__header">
              <h2>Reabrir Ciclo Operacional</h2>
              <button
                type="button"
                className="btn btn--secondary"
                style={{ minHeight: "32px", padding: "4px 8px" }}
                onClick={() => setShowReopenModal(false)}
              >
                ✕
              </button>
            </header>
            <div className="alloc-modal__body">
              <p>
                A reabertura permite corrigir ou alterar as destinações já fechadas. Por motivos de
                auditoria, informe o motivo:
              </p>
              <label
                htmlFor="reopen-reason"
                style={{ fontSize: "12px", fontWeight: "700", color: "#475569" }}
              >
                Justificativa obrigatória (mínimo 5 caracteres):
              </label>
              <textarea
                id="reopen-reason"
                rows={3}
                className="alloc-search-input"
                style={{ width: "100%", resize: "vertical" }}
                placeholder="Ex: Correção de sobra de produto no fornecedor JEB..."
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
              />
              {reopenError ? (
                <div style={{ color: "#dc2626", fontSize: "13px" }}>⚠️ {reopenError}</div>
              ) : null}
            </div>
            <footer className="alloc-modal__footer">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setShowReopenModal(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={reopening || reopenReason.trim().length < 5}
                onClick={handleConfirmReopenCycle}
              >
                {reopening ? "Reabrindo..." : "Confirmar Reabertura"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {/* MODAL: PRODUTOS PENDENTES DE DESTINAÇÃO */}
      {showUnassignedModal ? (
        <div className="alloc-modal-backdrop" role="dialog" aria-modal="true">
          <div className="alloc-modal">
            <header className="alloc-modal__header">
              <h2>Produtos Comprados sem Fornecedor ({unassignedPurchasedProducts.length})</h2>
              <button
                type="button"
                className="btn btn--secondary"
                style={{ minHeight: "32px", padding: "4px 8px" }}
                onClick={() => setShowUnassignedModal(false)}
              >
                ✕
              </button>
            </header>
            <div className="alloc-modal__body">
              <p>
                Os seguintes itens estão marcados como comprados na tela de custos do comprador,
                porém ainda não foram atribuídos a nenhum fornecedor neste ciclo:
              </p>
              <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px" }}>
                {unassignedPurchasedProducts.map((p) => (
                  <li key={p.id} style={{ marginBottom: "6px" }}>
                    <strong>[{p.erpCode}] {p.name}</strong> ({p.purchaseFormat})
                  </li>
                ))}
              </ul>
            </div>
            <footer className="alloc-modal__footer">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setShowUnassignedModal(false)}
              >
                Fechar
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {/* MODAL: ADICIONAR PRODUTO DO CATÁLOGO */}
      {showAddProductModal ? (
        <div className="alloc-modal-backdrop" role="dialog" aria-modal="true">
          <div className="alloc-modal" style={{ maxWidth: "600px" }}>
            <header className="alloc-modal__header">
              <h2>Adicionar Produto para Destinação</h2>
              <button
                type="button"
                className="btn btn--secondary"
                style={{ minHeight: "32px", padding: "4px 8px" }}
                onClick={() => setShowAddProductModal(false)}
              >
                ✕
              </button>
            </header>
            <div className="alloc-modal__body">
              <input
                type="search"
                className="alloc-search-input"
                style={{ width: "100%" }}
                placeholder="Buscar produto por código ERP ou nome..."
                value={catalogSearchQuery}
                onChange={(e) => setCatalogSearchQuery(e.target.value)}
              />

              <div
                style={{
                  maxHeight: "340px",
                  overflowY: "auto",
                  border: "1px solid #e2e8f0",
                  borderRadius: "6px",
                }}
              >
                {filteredCatalogItems.length > 0 ? (
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {filteredCatalogItems.map((item) => {
                      const isExclusiveToOther =
                        item.isExclusive &&
                        item.exclusiveSupplierId &&
                        item.exclusiveSupplierId !== selectedSupplierId;

                      return (
                        <li
                          key={item.id}
                          style={{
                            padding: "10px 14px",
                            borderBottom: "1px solid #f1f5f9",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            backgroundColor: isExclusiveToOther ? "#fff7ed" : "#fff",
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: "700", fontSize: "14px" }}>
                              [{item.erpCode}] {item.name}
                            </div>
                            <div style={{ fontSize: "12px", color: "#64748b" }}>
                              Formato: {item.purchaseFormat}
                              {isExclusiveToOther ? (
                                <span style={{ color: "#c2410c", marginLeft: "6px", fontWeight: "600" }}>
                                  (Exclusivo: {item.exclusiveSupplierName ?? "Outro fornecedor"})
                                </span>
                              ) : null}
                            </div>
                          </div>

                          <button
                            type="button"
                            className="btn btn--primary"
                            style={{ minHeight: "32px", padding: "4px 10px", fontSize: "12px" }}
                            disabled={Boolean(isExclusiveToOther)}
                            onClick={() => handleAddProductFromCatalog(item)}
                          >
                            {isExclusiveToOther ? "Bloqueado" : "+ Adicionar"}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div style={{ padding: "16px", textAlign: "center", color: "#64748b" }}>
                    Nenhum produto encontrado.
                  </div>
                )}
              </div>
            </div>
            <footer className="alloc-modal__footer">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setShowAddProductModal(false)}
              >
                Fechar
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
