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

type PendingNavigationAction = {
  type: "store" | "supplier" | "cycle";
  targetId: string;
};

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
    selectedStoreId,
    selectedSupplierId,
    closure,
    suppliers,
    stores,
    destinationData,
    unassignedPurchasedProducts,
    catalogSearchList,
    cycleStoreOrders,
    storeSummary,
  } = data;

  const isClosed = closure.status === "CLOSED";

  // Identifica loja ativa (Loja -> Fornecedor -> Produtos)
  const activeStore =
    stores.find((s) => s.id === selectedStoreId) ?? stores[0] ?? {
      id: "unknown",
      slug: "loja",
      name: "Loja",
    };
  const activeStoreId = activeStore.id;

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

  // Modais de fechamento / reabertura
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

  // Modal de confirmação de alterações não salvas (Unsaved Changes Guard)
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [pendingAction, setPendingAction] =
    useState<PendingNavigationAction | null>(null);

  // Navegação segura com guarda de alterações não salvas
  const executeNavigation = (action: PendingNavigationAction) => {
    if (action.type === "store") {
      router.push(
        `/comprador/destinacao?ciclo=${cycleDate}&loja=${action.targetId}&fornecedor=${selectedSupplierId ?? ""}`,
      );
    } else if (action.type === "supplier") {
      router.push(
        `/comprador/destinacao?ciclo=${cycleDate}&loja=${activeStoreId}&fornecedor=${action.targetId}`,
      );
    } else if (action.type === "cycle") {
      router.push(
        `/comprador/destinacao?ciclo=${action.targetId}&loja=${activeStoreId}&fornecedor=${selectedSupplierId ?? ""}`,
      );
    }
  };

  const handleSelectStore = (targetStoreId: string) => {
    if (targetStoreId === activeStoreId) return;
    if (isDirty) {
      setPendingAction({ type: "store", targetId: targetStoreId });
      setShowUnsavedModal(true);
      return;
    }
    executeNavigation({ type: "store", targetId: targetStoreId });
  };

  const handleSelectSupplier = (targetSupplierId: string) => {
    if (targetSupplierId === selectedSupplierId) return;
    if (isDirty) {
      setPendingAction({ type: "supplier", targetId: targetSupplierId });
      setShowUnsavedModal(true);
      return;
    }
    executeNavigation({ type: "supplier", targetId: targetSupplierId });
  };

  const handleSelectCycle = (targetCycleDate: string) => {
    if (targetCycleDate === cycleDate) return;
    if (isDirty) {
      setPendingAction({ type: "cycle", targetId: targetCycleDate });
      setShowUnsavedModal(true);
      return;
    }
    executeNavigation({ type: "cycle", targetId: targetCycleDate });
  };

  const handleUnsavedProceedDiscard = () => {
    setIsDirty(false);
    setShowUnsavedModal(false);
    if (pendingAction) {
      executeNavigation(pendingAction);
      setPendingAction(null);
    }
  };

  const handleUnsavedSaveAndProceed = async () => {
    if (!pendingAction) return;
    const target = pendingAction;
    setShowUnsavedModal(false);
    await handleSaveAllocations(() => {
      executeNavigation(target);
      setPendingAction(null);
    });
  };

  // Atualiza quantidade destinada para a LOJA ATIVA em um produto
  const handleQuantityChange = (productId: string, rawVal: string) => {
    if (isClosed) return;

    setProducts((prev) =>
      prev.map((prod) => {
        if (prod.productId !== productId) return prod;

        const currentStore = prod.stores[activeStoreId] ?? {
          storeId: activeStoreId,
          storeName: activeStore.name,
          storeSlug: activeStore.slug,
          orderedQuantity:
            cycleStoreOrders[prod.productId]?.[activeStoreId] ?? "0.00",
          destinedQuantity: "0.00",
          difference: "0.00",
          isAdditionalPurchase: false,
        };

        const val = rawVal.replace(",", ".");
        const numVal = parseQuantity(val);
        const destinedQty = val === "" ? "0.00" : roundToTwoDecimals(numVal);
        const diff = calculateDifference(
          destinedQty,
          currentStore.orderedQuantity,
        );
        const isAdditional =
          parseQuantity(currentStore.orderedQuantity) === 0 &&
          parseQuantity(destinedQty) > 0;

        const updatedStores = {
          ...prod.stores,
          [activeStoreId]: {
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
          parseQuantity(prod.totalOrdered) === 0 &&
          parseQuantity(totalDestined) > 0;

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

  const handleStepQuantity = (productId: string, delta: number) => {
    if (isClosed) return;

    const prod = products.find((p) => p.productId === productId);
    if (!prod) return;

    const currentStore = prod.stores[activeStoreId];
    const currentNum = parseQuantity(currentStore?.destinedQuantity ?? "0.00");
    const newNum = Math.max(0, currentNum + delta);
    handleQuantityChange(productId, String(newNum));
  };

  const handleSuggestOrder = (productId: string) => {
    if (isClosed) return;

    const prod = products.find((p) => p.productId === productId);
    if (!prod) return;

    const storeAlloc = prod.stores[activeStoreId];
    if (!storeAlloc) return;

    handleQuantityChange(productId, storeAlloc.orderedQuantity);
  };

  // Salva destinações exclusivamente para a loja ativa e fornecedor atual
  const handleSaveAllocations = async (onSuccessCallback?: () => void) => {
    if (!selectedSupplierId || isClosed || saving) return;

    setSaving(true);
    setErrorMessage(null);
    setSaveMessage(null);

    try {
      const payload = {
        cycleDate,
        supplierId: selectedSupplierId,
        storeId: activeStoreId,
        allocations: products.map((prod) => ({
          productId: prod.productId,
          stores: [
            {
              storeId: activeStoreId,
              destinedQuantity:
                prod.stores[activeStoreId]?.destinedQuantity ?? "0.00",
              notes: prod.stores[activeStoreId]?.notes ?? undefined,
            },
          ],
        })),
      };

      const result = await saveSupplierAllocationsAction(payload);

      if (result.status === "success") {
        setIsDirty(false);
        setSaveMessage(`Destinações salvas com sucesso para ${activeStore.name}!`);
        if (onSuccessCallback) {
          onSuccessCallback();
        } else {
          startTransition(() => {
            router.refresh();
          });
        }
      } else {
        setErrorMessage(result.message);
      }
    } catch {
      setErrorMessage("Erro de rede ao salvar destinações.");
    } finally {
      setSaving(false);
    }
  };

  // Adiciona produto do catálogo — RESOLUÇÃO IMEDIATA DO PEDIDO (Bug 01 corrigido!)
  const handleAddProductFromCatalog = (item: CatalogSearchItem) => {
    if (products.some((p) => p.productId === item.id)) {
      setShowAddProductModal(false);
      return;
    }

    const newStoreAllocations: Record<string, StoreAllocationData> = {};
    const orderedQtyList: string[] = [];
    const destinedQtyList: string[] = [];

    for (const store of stores) {
      // Busca imediata do pedido das lojas a partir do mapa do ciclo já carregado
      const orderQty = cycleStoreOrders[item.id]?.[store.id] ?? "0.00";
      const orderNum = parseQuantity(orderQty);

      // Sugestão inicial da quantidade do pedido para a loja ativa
      const destinedQty =
        store.id === activeStoreId && orderNum > 0
          ? roundToTwoDecimals(orderNum)
          : "0.00";
      const diff = calculateDifference(destinedQty, orderQty);
      const isAdditional = orderNum === 0;

      newStoreAllocations[store.id] = {
        storeId: store.id,
        storeName: store.name,
        storeSlug: store.slug,
        orderedQuantity: roundToTwoDecimals(orderQty),
        destinedQuantity: destinedQty,
        difference: diff,
        isAdditionalPurchase: isAdditional,
      };

      orderedQtyList.push(orderQty);
      destinedQtyList.push(destinedQty);
    }

    const totalOrdered = sumQuantities(orderedQtyList);
    const totalDestined = sumQuantities(destinedQtyList);
    const totalDiff = calculateDifference(totalDestined, totalOrdered);
    const isAdditionalOverall =
      parseQuantity(totalOrdered) === 0 && parseQuantity(totalDestined) > 0;

    const newProduct: ProductAllocationItem = {
      productId: item.id,
      erpCode: item.erpCode,
      productName: item.name,
      purchaseFormat: item.purchaseFormat,
      isExclusive: item.isExclusive,
      exclusiveSupplierId: item.exclusiveSupplierId,
      exclusiveSupplierName: item.exclusiveSupplierName,
      hasOfficialCost: false,
      officialCost: null,
      purchasedInCosts: item.purchasedInCosts ?? false,
      isAdditionalPurchase: isAdditionalOverall,
      conversionFactorKg: null,
      conversionOrigin: null,
      stores: newStoreAllocations,
      totalOrdered,
      totalDestined,
      totalDifference: totalDiff,
      version: 1,
    };

    setProducts((prev) => [newProduct, ...prev]);
    setIsDirty(true);
    setSaveMessage(null);
    setShowAddProductModal(false);
    setCatalogSearchQuery("");
  };

  // Fechamento operacional
  const handleConfirmCloseCycle = async () => {
    setClosing(true);
    setCloseError(null);

    try {
      const result = await closeBuyerCycleAction({ cycleDate });
      if (result.status === "success") {
        setShowCloseModal(false);
        startTransition(() => {
          router.refresh();
        });
      } else {
        setCloseError(result.message);
      }
    } catch {
      setCloseError("Erro inesperado ao fechar ciclo.");
    } finally {
      setClosing(false);
    }
  };

  // Reabertura operacional
  const handleConfirmReopenCycle = async () => {
    setReopening(true);
    setReopenError(null);

    try {
      const result = await reopenBuyerCycleAction({
        cycleDate,
        reason: reopenReason,
      });

      if (result.status === "success") {
        setShowReopenModal(false);
        setReopenReason("");
        startTransition(() => {
          router.refresh();
        });
      } else {
        setReopenError(result.message);
      }
    } catch {
      setReopenError("Erro inesperado ao reabrir ciclo.");
    } finally {
      setReopening(false);
    }
  };

  // Filtra produtos na tela por nome ou código ERP
  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return products;
    const q = searchQuery.toLowerCase().trim();
    return products.filter(
      (p) =>
        p.productName.toLowerCase().includes(q) ||
        String(p.erpCode).includes(q),
    );
  }, [products, searchQuery]);

  // Filtra itens do catálogo no modal de adição
  const filteredCatalogItems = useMemo(() => {
    const existingIds = new Set(products.map((p) => p.productId));
    const available = catalogSearchList.filter((item) => !existingIds.has(item.id));
    if (!catalogSearchQuery.trim()) return available.slice(0, 50);

    const q = catalogSearchQuery.toLowerCase().trim();
    return available
      .filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          String(item.erpCode).includes(q),
      )
      .slice(0, 50);
  }, [catalogSearchList, products, catalogSearchQuery]);

  const selectedSupplier = suppliers.find((s) => s.id === selectedSupplierId);

  // Calcula índice do próximo fornecedor para troca rápida
  const currentSupplierIndex = suppliers.findIndex((s) => s.id === selectedSupplierId);
  const nextSupplier =
    suppliers.length > 1 && currentSupplierIndex >= 0
      ? suppliers[(currentSupplierIndex + 1) % suppliers.length]
      : null;

  // Total destinado na loja ativa para o fornecedor atual
  const activeStoreTotalDestined = sumQuantities(
    products.map((p) => p.stores[activeStoreId]?.destinedQuantity ?? "0.00"),
  );

  return (
    <div className="alloc-workspace">
      {/* BARRA SUPERIOR: TÍTULO, SELEÇÃO DE CICLO */}
      <div className="alloc-topbar">
        <div className="alloc-topbar__title">
          <h1>Destinação de Compras (Pós-Embarque)</h1>
          <p>
            Fluxo operacional: <strong>Loja → Fornecedor → Produtos</strong>
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
            onChange={(e) => handleSelectCycle(e.target.value)}
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

      {/* BANNER DE STATUS GERAL DO CICLO */}
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
                {closure.totalAllocatedProducts} produtos com destinação •{" "}
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

      {/* NÍVEL 1: SELEÇÃO DA LOJA (DESTAQUE MÁXIMO MOBILE) */}
      <nav className="alloc-store-nav" aria-label="Seleção da Loja Ativa">
        <div className="alloc-store-nav__header">
          <span className="alloc-step-indicator">1. LOJA ATIVA:</span>
          <span className="alloc-store-nav__hint">
            A loja permanece selecionada ao trocar de fornecedor
          </span>
        </div>
        <div className="alloc-store-tabs">
          {stores.map((store) => {
            const isActive = store.id === activeStoreId;
            const summary = storeSummary[store.id];
            const cleanName = store.name.replace("MultiShow ", "");

            return (
              <button
                key={store.id}
                type="button"
                className={`alloc-store-tab ${isActive ? "alloc-store-tab--active" : ""}`}
                onClick={() => handleSelectStore(store.id)}
                aria-pressed={isActive}
              >
                <div className="alloc-store-tab__title">
                  <span className="alloc-store-tab__icon">🏪</span>
                  <strong>{cleanName}</strong>
                </div>
                <div className="alloc-store-tab__badge">
                  {summary ? `${summary.totalDestinedQuantity} CX` : "0.00 CX"}
                </div>
              </button>
            );
          })}
        </div>
      </nav>

      {/* NÍVEL 2: SELEÇÃO DO FORNECEDOR (LOGO ABAIXO DA LOJA) */}
      <section className="alloc-supplier-section" aria-label="Seleção do Fornecedor">
        <div className="alloc-supplier-section__header">
          <div className="alloc-step-indicator">
            2. FORNECEDOR (PARA {activeStore.name.toUpperCase()}):
          </div>
          <div className="alloc-supplier-select-row">
            <select
              id="supplier-selector"
              className="alloc-select alloc-select--supplier"
              value={selectedSupplierId ?? ""}
              onChange={(e) => handleSelectSupplier(e.target.value)}
            >
              <option value="" disabled>
                -- Selecione o fornecedor para esta loja --
              </option>
              {suppliers.map((s) => {
                const storeVol = s.destinedByStore[activeStoreId] ?? "0.00";
                return (
                  <option key={s.id} value={s.id}>
                    {s.corporateName} {s.tradeName ? `(${s.tradeName})` : ""} — {storeVol} CX nesta loja
                  </option>
                );
              })}
            </select>

            {nextSupplier ? (
              <button
                type="button"
                className="btn btn--secondary alloc-btn-next-supplier"
                title={`Alternar para ${nextSupplier.corporateName} mantendo ${activeStore.name}`}
                onClick={() => handleSelectSupplier(nextSupplier.id)}
              >
                Trocar Fornecedor ❯
              </button>
            ) : null}
          </div>
        </div>

        {selectedSupplier ? (
          <div className="alloc-supplier-info-card">
            <div className="alloc-supplier-info-row">
              <div>
                <strong className="alloc-supplier-name">
                  {selectedSupplier.corporateName}
                </strong>
                {selectedSupplier.tradeName ? (
                  <span className="alloc-supplier-trade">
                    ({selectedSupplier.tradeName})
                  </span>
                ) : null}
              </div>
              <div className="alloc-supplier-actions">
                <Link
                  href={`/comprador/fornecedores/${selectedSupplier.id}/faturamento`}
                  className="alloc-billing-link"
                  target="_blank"
                >
                  📄 Faturamento deste Fornecedor ↗
                </Link>
              </div>
            </div>

            <div className="alloc-supplier-meta-row">
              {selectedSupplier.taxId ? (
                <span className="alloc-meta-item">
                  <strong>CNPJ:</strong> {formatTaxId(selectedSupplier.taxId)}
                </span>
              ) : null}
              <span className="alloc-meta-item alloc-meta-item--highlight">
                <strong>Destinado em {activeStore.name.replace("MultiShow ", "")}:</strong>{" "}
                {activeStoreTotalDestined} CX
              </span>
              <span className="alloc-meta-item" style={{ color: "#64748b" }}>
                Total ciclo (todas as lojas): {selectedSupplier.totalDestinedQuantity} CX
              </span>
            </div>
          </div>
        ) : null}
      </section>

      {/* MENSAGENS DE FEEDBACK */}
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

      {/* NÍVEL 3: LISTA DE PRODUTOS (SOMENTE DA LOJA ATIVA) */}
      {selectedSupplierId ? (
        <section aria-label="Produtos para destinação da loja ativa">
          <div className="alloc-products-toolbar">
            <input
              type="search"
              className="alloc-search-input"
              placeholder={`Buscar produto para ${activeStore.name.replace("MultiShow ", "")}...`}
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
            <div className="alloc-products-list">
              {filteredProducts.map((prod) => {
                const storeData = prod.stores[activeStoreId] ?? {
                  storeId: activeStoreId,
                  storeName: activeStore.name,
                  storeSlug: activeStore.slug,
                  orderedQuantity: "0.00",
                  destinedQuantity: "0.00",
                  difference: "0.00",
                  isAdditionalPurchase: false,
                };

                const diff = storeData.difference;
                const isSurplus = diff.startsWith("+") && diff !== "+0.00";
                const isCut = diff.startsWith("-");
                const hasOrder = parseQuantity(storeData.orderedQuantity) > 0;
                const isDifferentFromOrder =
                  hasOrder && storeData.destinedQuantity !== storeData.orderedQuantity;

                // Soma das outras lojas para referência rápida
                const otherStoresDestined = sumQuantities(
                  stores
                    .filter((s) => s.id !== activeStoreId)
                    .map((s) => prod.stores[s.id]?.destinedQuantity ?? "0.00"),
                );

                return (
                  <article key={prod.productId} className="alloc-product-card">
                    <header className="alloc-product-header">
                      <div className="alloc-product-info">
                        <div className="alloc-product-title">
                          <span className="alloc-product-erp">{prod.erpCode}</span>
                          <strong className="alloc-product-name">
                            {prod.productName}
                          </strong>
                          <span className="alloc-product-format">
                            ({prod.purchaseFormat})
                          </span>
                        </div>
                        <div className="alloc-badges">
                          {prod.isExclusive ? (
                            <span className="alloc-badge alloc-badge--exclusive">
                              Exclusivo JEB
                            </span>
                          ) : null}
                          {storeData.isAdditionalPurchase || prod.isAdditionalPurchase ? (
                            <span className="alloc-badge alloc-badge--additional">
                              Sem Pedido / Oportunidade
                            </span>
                          ) : null}
                          {!prod.hasOfficialCost ? (
                            <span className="alloc-badge alloc-badge--no-cost">
                              Sem custo oficial
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </header>

                    {/* ÁREA DE EDIÇÃO EXCLUSIVA DA LOJA ATIVA */}
                    <div className="alloc-single-store-panel">
                      <div className="alloc-single-store-panel__info">
                        <div className="alloc-single-store-name">
                          <span className="alloc-store-icon">🏪</span>
                          <strong>{activeStore.name}</strong>
                        </div>
                        <div className="alloc-single-store-order">
                          {hasOrder ? (
                            <span className="alloc-order-tag">
                              Pedido da loja: <strong>{storeData.orderedQuantity} {prod.purchaseFormat}</strong>
                            </span>
                          ) : (
                            <span className="alloc-no-order-tag">
                              Sem pedido registrado para esta loja
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="alloc-single-store-controls">
                        <div className="alloc-stepper">
                          <button
                            type="button"
                            className="alloc-stepper-btn"
                            disabled={isClosed}
                            aria-label={`Diminuir quantidade`}
                            onClick={() => handleStepQuantity(prod.productId, -1)}
                          >
                            −
                          </button>
                          <input
                            type="text"
                            inputMode="decimal"
                            className="alloc-stepper-input"
                            disabled={isClosed}
                            value={storeData.destinedQuantity}
                            onChange={(e) =>
                              handleQuantityChange(prod.productId, e.target.value)
                            }
                          />
                          <button
                            type="button"
                            className="alloc-stepper-btn"
                            disabled={isClosed}
                            aria-label={`Aumentar quantidade`}
                            onClick={() => handleStepQuantity(prod.productId, 1)}
                          >
                            +
                          </button>
                        </div>

                        {/* Botão de Sugestão Tátil de Pedido */}
                        {isDifferentFromOrder && !isClosed ? (
                          <button
                            type="button"
                            className="alloc-suggest-btn"
                            title="Igualar destinação ao pedido da loja"
                            onClick={() => handleSuggestOrder(prod.productId)}
                          >
                            Sugerir Pedido ({storeData.orderedQuantity})
                          </button>
                        ) : null}

                        {/* Indicador de Diferença */}
                        <span
                          className={`alloc-diff-pill ${
                            isCut
                              ? "alloc-diff-pill--cut"
                              : isSurplus
                              ? "alloc-diff-pill--surplus"
                              : "alloc-diff-pill--neutral"
                          }`}
                        >
                          {diff} {isCut ? "(Corte)" : isSurplus ? "(Adicional)" : "(Atendido)"}
                        </span>
                      </div>
                    </div>

                    {/* RODAPÉ COMPACTO: REFERÊNCIA DAS OUTRAS UNIDADES */}
                    <footer className="alloc-product-card-footer">
                      <span className="alloc-other-stores-hint">
                        Outras lojas somadas: <strong>{otherStoresDestined} {prod.purchaseFormat}</strong>
                      </span>
                      <span className="alloc-cycle-total-hint">
                        Total ciclo: <strong>{prod.totalDestined} {prod.purchaseFormat}</strong>
                      </span>
                    </footer>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="alloc-empty-state">
              <p>Nenhum produto cadastrado para este fornecedor.</p>
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

          {/* BARRA FIXA DE SALVAR DA LOJA ATIVA */}
          {!isClosed ? (
            <div className="alloc-sticky-bar">
              <div className="alloc-sticky-info">
                <div className="alloc-sticky-store">
                  🏪 <strong>{activeStore.name.replace("MultiShow ", "")}</strong> •{" "}
                  <span>{activeStoreTotalDestined} CX</span>
                </div>
                <span className="alloc-sticky-status">
                  {isDirty ? (
                    <strong style={{ color: "#d97706" }}>⚠️ Alterações não salvas</strong>
                  ) : (
                    <span style={{ color: "#16a34a" }}>✓ Todas as alterações salvas</span>
                  )}
                </span>
              </div>

              <div className="alloc-sticky-buttons">
                <button
                  type="button"
                  className="btn btn--primary alloc-save-btn"
                  disabled={saving || !isDirty}
                  onClick={() => handleSaveAllocations()}
                >
                  {saving ? "Salvando..." : `Salvar Destinações desta Loja`}
                </button>

                {nextSupplier ? (
                  <button
                    type="button"
                    className="btn btn--secondary alloc-quick-next-btn"
                    onClick={() => handleSelectSupplier(nextSupplier.id)}
                    title={`Salvar ou alternar para ${nextSupplier.corporateName}`}
                  >
                    Próximo Fornecedor →
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      ) : (
        <div className="alloc-empty-state">
          <span style={{ fontSize: "36px" }}>🚚</span>
          <h2>Selecione um fornecedor para iniciar a destinação</h2>
          <p>
            Você visualizará somente os pedidos de <strong>{activeStore.name}</strong> e poderá
            ajustar as quantidades de forma ágil no celular.
          </p>
        </div>
      )}

      {/* MODAL DE ALERTA: ALTERAÇÕES NÃO SALVAS (UNSAVED CHANGES GUARD) */}
      {showUnsavedModal ? (
        <div className="alloc-modal-backdrop" role="dialog" aria-modal="true">
          <div className="alloc-modal">
            <header className="alloc-modal__header">
              <h2>⚠️ Alterações não salvas</h2>
              <button
                type="button"
                className="btn btn--secondary"
                style={{ minHeight: "32px", padding: "4px 8px" }}
                onClick={() => setShowUnsavedModal(false)}
              >
                ✕
              </button>
            </header>
            <div className="alloc-modal__body">
              <p>
                Você possui lançamentos pendentes de gravação para a loja{" "}
                <strong>{activeStore.name}</strong>
                {selectedSupplier ? (
                  <>
                    {" "}no fornecedor <strong>{selectedSupplier.corporateName}</strong>
                  </>
                ) : null}
                .
              </p>
              <p style={{ fontSize: "13px", color: "#64748b" }}>
                Se você trocar de loja ou fornecedor sem salvar, as alterações desta tela serão
                descartadas.
              </p>
            </div>
            <footer className="alloc-modal__footer">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setShowUnsavedModal(false)}
              >
                Continuar Editando
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={handleUnsavedProceedDiscard}
              >
                Descartar Alterações
              </button>
              <button
                type="button"
                className="btn btn--success"
                onClick={handleUnsavedSaveAndProceed}
              >
                Salvar e Continuar
              </button>
            </footer>
          </div>
        </div>
      ) : null}

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

              <div className="alloc-summary-box">
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
                <div className="alloc-error-box">
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
                  ✓ Todos os produtos comprados possuem fornecedor e destinação positiva em ao menos uma loja.
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
                placeholder="Ex: Correção de sobra de produto no fornecedor..."
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

      {/* MODAL: ADICIONAR PRODUTO DO CATÁLOGO (RESOLUÇÃO IMEDIATA) */}
      {showAddProductModal ? (
        <div className="alloc-modal-backdrop" role="dialog" aria-modal="true">
          <div className="alloc-modal" style={{ maxWidth: "600px" }}>
            <header className="alloc-modal__header">
              <h2>Adicionar Produto para {activeStore.name.replace("MultiShow ", "")}</h2>
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

              <div className="alloc-modal-catalog-list">
                {filteredCatalogItems.length > 0 ? (
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {filteredCatalogItems.map((item) => {
                      const isExclusiveToOther =
                        item.isExclusive &&
                        item.exclusiveSupplierId &&
                        item.exclusiveSupplierId !== selectedSupplierId;

                      const orderForActiveStore =
                        cycleStoreOrders[item.id]?.[activeStoreId] ?? "0.00";
                      const hasOrderInActive = parseQuantity(orderForActiveStore) > 0;

                      return (
                        <li
                          key={item.id}
                          className="alloc-modal-catalog-item"
                          style={{
                            backgroundColor: isExclusiveToOther ? "#fff7ed" : "#fff",
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: "700", fontSize: "14px" }}>
                              [{item.erpCode}] {item.name}
                            </div>
                            <div style={{ fontSize: "12px", color: "#64748b" }}>
                              Formato: {item.purchaseFormat}
                              {hasOrderInActive ? (
                                <span style={{ color: "#006b4f", marginLeft: "6px", fontWeight: "600" }}>
                                  • Pedido {activeStore.name.replace("MultiShow ", "")}: {orderForActiveStore}
                                </span>
                              ) : (
                                <span style={{ color: "#b45309", marginLeft: "6px" }}>
                                  • Sem pedido nesta loja (Oportunidade)
                                </span>
                              )}
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
                            style={{ minHeight: "34px", padding: "4px 12px", fontSize: "13px" }}
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
