"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { formatTaxId } from "@/modules/suppliers/domain";
import {
  closeBuyerCycleAction,
  closeStoreCycleAction,
  concludeSupplierStoreReviewAction,
  reopenBuyerCycleAction,
  reopenStoreCycleAction,
  revertProductSupplierDecisionAction,
  saveSupplierAllocationsAction,
  setProductSupplierDecisionAction,
} from "./actions";
import {
  registerInvoiceAction,
  deleteInvoiceAction,
} from "@/modules/purchasing/invoices/actions";
import type { InvoiceRecord } from "@/modules/purchasing/invoices/domain";
import {
  calculateDifference,
  hasPendingStoreAllocation,
  parseQuantity,
  roundToTwoDecimals,
  sumQuantities,
  type AllocationConflictResolution,
  type AllocationDestinationConflict,
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

type PendingAllocationConflict = {
  conflicts: AllocationDestinationConflict[];
  resolutions: Record<
    string,
    { resolution: AllocationConflictResolution; fingerprint: string }
  >;
  onSuccessCallback?: () => void;
};

export function BuyerAllocationWorkspace({
  data,
  hasExplicitStoreSelection = true,
}: {
  data: BuyerAllocationWorkspaceData;
  hasExplicitStoreSelection?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [showStoreSelectModal, setShowStoreSelectModal] = useState(!hasExplicitStoreSelection);

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
    storeClosures = {},
    supplierStoreReviews = {},
    invoicesByStoreSupplier = {},
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

  // Status de finalização das lojas
  const activeStoreSummary = storeSummary[activeStoreId];
  const activeStoreClosure = storeClosures[activeStoreId];
  const allStoresFinalized = stores.length > 0 && stores.every(
    (s) => storeSummary[s.id]?.closureStatus === "CLOSED" && !storeSummary[s.id]?.isStale,
  );
  const unclosedStores = stores.filter(
    (s) => storeSummary[s.id]?.closureStatus !== "CLOSED" || storeSummary[s.id]?.isStale,
  );
  // O componente é remontado pela página quando o contexto confirmado muda.
  // Enquanto uma navegação ainda está em trânsito, porém, os props continuam
  // apontando para o contexto anterior. O ref preserva sincronamente a última
  // intenção do usuário para que uma segunda seleção não reverta loja/ciclo.
  const navigationContextRef = useRef({
    cycleDate,
    storeId: activeStoreId,
    supplierId: selectedSupplierId ?? "",
  });

  // Estado local dos produtos do fornecedor selecionado
  const [products, setProducts] = useState<ProductAllocationItem[]>(
    destinationData?.products ?? [],
  );
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingConflict, setPendingConflict] =
    useState<PendingAllocationConflict | null>(null);

  // Filtro de busca na lista de produtos
  const [searchQuery, setSearchQuery] = useState("");

  // Modais de fechamento / reabertura do ciclo geral
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const [showReopenModal, setShowReopenModal] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [reopenError, setReopenError] = useState<string | null>(null);

  // Modais de conferência conjunta de cortes e finalização da loja
  const [showStoreClosureModal, setShowStoreClosureModal] = useState(false);
  const [targetStoreForClosure, setTargetStoreForClosure] = useState<string>(activeStoreId);
  const [closingStore, setClosingStore] = useState(false);
  const [storeCloseError, setStoreCloseError] = useState<string | null>(null);

  const [showReopenStoreModal, setShowReopenStoreModal] = useState(false);
  const [reopeningStore, setReopeningStore] = useState(false);
  const [reopenStoreReason, setReopenStoreReason] = useState("");
  const [reopenStoreError, setReopenStoreError] = useState<string | null>(null);

  // Modal de conclusão em lote do fornecedor para a loja ativa
  const [showBatchConcludeSupplierModal, setShowBatchConcludeSupplierModal] = useState(false);
  const [concludingSupplier, setConcludingSupplier] = useState(false);
  const [batchConcludeError, setBatchConcludeError] = useState<string | null>(null);

  // Confirmação de segurança para "Não comprei deste fornecedor" com destinação positiva
  const [productToReject, setProductToReject] = useState<{
    productId: string;
    productName: string;
    destinedQty: string;
  } | null>(null);
  const [rejectingProduct, setRejectingProduct] = useState(false);

  const [showUnassignedModal, setShowUnassignedModal] = useState(false);
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [catalogSearchQuery, setCatalogSearchQuery] = useState("");

  // Modal de confirmação explícita de compra de oportunidade (Regra B)
  const [pendingOpportunityItem, setPendingOpportunityItem] =
    useState<CatalogSearchItem | null>(null);
  const [opportunityQuantity, setOpportunityQuantity] = useState<string>("1");
  const [opportunityError, setOpportunityError] = useState<string | null>(null);

  // Modal de confirmação de alterações não salvas (Unsaved Changes Guard)
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [pendingAction, setPendingAction] =
    useState<PendingNavigationAction | null>(null);

  const targetStore = stores.find((s) => s.id === targetStoreForClosure) ?? activeStore;
  const targetStoreClosure = storeClosures[targetStore.id] ?? activeStoreClosure;

  const activeSupplier = suppliers.find((s) => s.id === selectedSupplierId);
  const activeSupplierReview = selectedSupplierId ? supplierStoreReviews[selectedSupplierId]?.[activeStoreId] : null;

  // Notas Fiscais do fornecedor selecionado para a loja ativa (Fase 4)
  const currentSupplierInvoices: InvoiceRecord[] = useMemo(() => {
    if (!selectedSupplierId || !invoicesByStoreSupplier[activeStoreId]) return [];
    return invoicesByStoreSupplier[activeStoreId][selectedSupplierId] || [];
  }, [invoicesByStoreSupplier, activeStoreId, selectedSupplierId]);

  // Modais de Nota Fiscal
  const [showRegisterInvoiceModal, setShowRegisterInvoiceModal] = useState(false);
  const [showViewInvoicesModal, setShowViewInvoicesModal] = useState(false);
  const [viewingPhotoUrl, setViewingPhotoUrl] = useState<string | null>(null);

  // Produtos com destinação positiva na loja ativa para o fornecedor selecionado
  const destinedProductsForSupplierAndStore = useMemo(() => {
    return products.filter((p) => {
      const storeData = p.stores[activeStoreId];
      return storeData && parseQuantity(storeData.destinedQuantity) > 0;
    });
  }, [products, activeStoreId]);

  // Formulário de registro de nota fiscal
  const [invoiceNumberInput, setInvoiceNumberInput] = useState("");
  const [invoiceNotesInput, setInvoiceNotesInput] = useState("");
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [invoicePreviewUrl, setInvoicePreviewUrl] = useState<string | null>(null);
  const [selectedInvoiceProductIds, setSelectedInvoiceProductIds] = useState<string[]>([]);
  const [registeringInvoice, setRegisteringInvoice] = useState(false);
  const [registerInvoiceError, setRegisterInvoiceError] = useState<string | null>(null);

  // Exclusão de nota fiscal
  const [deletingInvoiceId, setDeletingInvoiceId] = useState<string | null>(null);

  const handleOpenRegisterInvoice = () => {
    setInvoiceNumberInput("");
    setInvoiceNotesInput("");
    setInvoiceFile(null);
    if (invoicePreviewUrl) URL.revokeObjectURL(invoicePreviewUrl);
    setInvoicePreviewUrl(null);
    setRegisterInvoiceError(null);
    setSelectedInvoiceProductIds(destinedProductsForSupplierAndStore.map((p) => p.productId));
    setShowRegisterInvoiceModal(true);
  };

  const handleInvoiceFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setRegisterInvoiceError("O tamanho da imagem excede o limite permitido de 10 MB.");
      return;
    }
    if (invoicePreviewUrl) URL.revokeObjectURL(invoicePreviewUrl);
    setInvoiceFile(file);
    setInvoicePreviewUrl(URL.createObjectURL(file));
    setRegisterInvoiceError(null);
  };

  const handleRemoveInvoiceFile = () => {
    if (invoicePreviewUrl) URL.revokeObjectURL(invoicePreviewUrl);
    setInvoiceFile(null);
    setInvoicePreviewUrl(null);
  };

  const handleSaveInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplierId) return;
    if (!invoiceNumberInput.trim()) {
      setRegisterInvoiceError("Número da nota fiscal é obrigatório.");
      return;
    }
    if (!invoiceFile) {
      setRegisterInvoiceError("A fotografia da nota fiscal é obrigatória.");
      return;
    }
    if (destinedProductsForSupplierAndStore.length === 0) {
      setRegisterInvoiceError("Não há produtos com destinação positiva para vincular a esta nota.");
      return;
    }
    if (selectedInvoiceProductIds.length === 0) {
      setRegisterInvoiceError("Selecione ao menos um produto destinado para vincular à nota fiscal.");
      return;
    }

    setRegisteringInvoice(true);
    setRegisterInvoiceError(null);

    const formData = new FormData();
    formData.append("cycleDate", cycleDate);
    formData.append("storeId", activeStoreId);
    formData.append("supplierId", selectedSupplierId);
    formData.append("invoiceNumber", invoiceNumberInput.trim());
    if (invoiceNotesInput.trim()) {
      formData.append("notes", invoiceNotesInput.trim());
    }
    formData.append("productIds", JSON.stringify(selectedInvoiceProductIds));
    formData.append("file", invoiceFile);

    try {
      const res = await registerInvoiceAction(formData);
      if (res.status === "success") {
        setShowRegisterInvoiceModal(false);
        handleRemoveInvoiceFile();
        startTransition(() => {
          router.refresh();
        });
      } else {
        setRegisterInvoiceError(res.message);
      }
    } catch {
      setRegisterInvoiceError("Erro ao registrar a nota fiscal. Tente novamente.");
    } finally {
      setRegisteringInvoice(false);
    }
  };

  const handleDeleteInvoice = async (invoiceId: string) => {
    if (!confirm("Deseja realmente excluir esta nota fiscal?")) return;
    setDeletingInvoiceId(invoiceId);
    try {
      const res = await deleteInvoiceAction(invoiceId);
      if (res.status === "success") {
        startTransition(() => {
          router.refresh();
        });
      } else {
        alert(res.message);
      }
    } catch {
      alert("Erro ao excluir nota fiscal.");
    } finally {
      setDeletingInvoiceId(null);
    }
  };

  const unreviewedItemsForSupplier = useMemo(
    () =>
      products.filter(
        (p) =>
          (p.stores[activeStoreId]?.persistedDestinedQuantity === null ||
            parseQuantity(p.stores[activeStoreId]?.persistedDestinedQuantity) <= 0) &&
          !p.supplierDecision,
      ),
    [products, activeStoreId],
  );
  const positiveDestinedCountForSupplier = useMemo(
    () =>
      products.filter(
        (p) =>
          p.stores[activeStoreId]?.persistedDestinedQuantity !== null &&
          parseQuantity(p.stores[activeStoreId]?.persistedDestinedQuantity) > 0,
      ).length,
    [products, activeStoreId],
  );

  const pendingProducts = useMemo(
    () => products.filter((product) => hasPendingStoreAllocation(product.stores[activeStoreId])),
    [activeStoreId, products],
  );
  const hasUnconfirmedSuggestions = pendingProducts.some(
    (product) => product.stores[activeStoreId]?.persistedDestinedQuantity === null,
  );
  const canSave = pendingProducts.length > 0;

  // Navegação segura com guarda de alterações não salvas
  const executeNavigation = (action: PendingNavigationAction) => {
    const nextContext = { ...navigationContextRef.current };
    if (action.type === "store") {
      nextContext.storeId = action.targetId;
    } else if (action.type === "supplier") {
      nextContext.supplierId = action.targetId;
    } else if (action.type === "cycle") {
      nextContext.cycleDate = action.targetId;
    }
    navigationContextRef.current = nextContext;
    router.push(
      `/comprador/destinacao?ciclo=${nextContext.cycleDate}&loja=${nextContext.storeId}&fornecedor=${nextContext.supplierId}`,
    );
  };

  const handleSelectStore = (targetStoreId: string, force = false) => {
    if (!force && hasExplicitStoreSelection && targetStoreId === navigationContextRef.current.storeId) return;
    if (isDirty && canSave) {
      setPendingAction({ type: "store", targetId: targetStoreId });
      setShowUnsavedModal(true);
      return;
    }
    executeNavigation({ type: "store", targetId: targetStoreId });
  };

  const handleSelectSupplier = (targetSupplierId: string) => {
    if (targetSupplierId === navigationContextRef.current.supplierId) return;
    if (isDirty && canSave) {
      setPendingAction({ type: "supplier", targetId: targetSupplierId });
      setShowUnsavedModal(true);
      return;
    }
    executeNavigation({ type: "supplier", targetId: targetSupplierId });
  };

  const handleSelectCycle = (targetCycleDate: string) => {
    if (targetCycleDate === navigationContextRef.current.cycleDate) return;
    if (isDirty && canSave) {
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
          persistedDestinedQuantity: null,
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
  const handleSaveAllocations = async (
    onSuccessCallback?: () => void,
    conflictResolutions: Record<
      string,
      { resolution: AllocationConflictResolution; fingerprint: string }
    > = {},
  ) => {
    if (!selectedSupplierId || isClosed || saving || pendingProducts.length === 0) return;

    // Validações locais de integridade (Bug 03 - Regras B e C)
    for (const prod of pendingProducts) {
      const storeData = prod.stores[activeStoreId];
      const destinedNum = parseQuantity(storeData?.destinedQuantity ?? "0.00");
      const totalCycleOrdersNum = parseQuantity(prod.totalOrdered);

      // Regra C: Produto com pedido das lojas não marcado como comprado nos custos não pode ter destinação positiva
      if (totalCycleOrdersNum > 0 && !prod.purchasedInCosts && destinedNum > 0) {
        setErrorMessage(
          `O produto "${prod.productName}" (ERP ${prod.erpCode}) possui pedido das lojas neste ciclo (${prod.totalOrdered} ${prod.purchaseFormat}), mas não está marcado como comprado na tela de custos. Zere a destinação para corrigir ou marque-o como comprado nos custos antes de salvar.`,
        );
        return;
      }

      // Regra B: Compra de oportunidade não pode ter quantidade zero (bloqueio de inclusão com zero)
      const wasInDatabase = Boolean(
        destinationData?.products.some((p) => p.productId === prod.productId),
      );
      if (
        totalCycleOrdersNum === 0 &&
        !prod.purchasedInCosts &&
        destinedNum === 0 &&
        !wasInDatabase
      ) {
        setErrorMessage(
          `A compra de oportunidade do produto "${prod.productName}" deve possuir quantidade destinada maior que zero.`,
        );
        return;
      }
    }

    setSaving(true);
    setErrorMessage(null);
    setSaveMessage(null);

    try {
      const payload = {
        cycleDate,
        supplierId: selectedSupplierId,
        storeId: activeStoreId,
        allocations: pendingProducts.map((prod) => ({
          productId: prod.productId,
          isOpportunityConfirmed: prod.isOpportunityConfirmed ?? undefined,
          notes: prod.notes ?? undefined,
          stores: [
            {
              storeId: activeStoreId,
              conflictResolution:
                conflictResolutions[`${prod.productId}:${activeStoreId}`]?.resolution,
              conflictFingerprint:
                conflictResolutions[`${prod.productId}:${activeStoreId}`]?.fingerprint,
              destinedQuantity:
                prod.stores[activeStoreId]?.destinedQuantity ?? "0.00",
              notes: prod.stores[activeStoreId]?.notes ?? undefined,
            },
          ],
        })),
      };

      const result = await saveSupplierAllocationsAction(payload);

      if (result.status === "success") {
        const savedProductIds = new Set(pendingProducts.map((product) => product.productId));
        setProducts((current) => current.map((product) => {
          if (!savedProductIds.has(product.productId)) return product;
          const storeData = product.stores[activeStoreId];
          if (!storeData) return product;
          const persistedDestinedQuantity =
            parseQuantity(storeData.destinedQuantity) > 0
              ? roundToTwoDecimals(storeData.destinedQuantity)
              : storeData.persistedDestinedQuantity !== null
              ? "0.00"
              : null;
          return {
            ...product,
            stores: {
              ...product.stores,
              [activeStoreId]: {
                ...storeData,
                persistedDestinedQuantity,
              },
            },
          };
        }));
        setIsDirty(false);
        setPendingConflict(null);
        setSaveMessage(`Destinações salvas com sucesso para ${activeStore.name}!`);
        if (onSuccessCallback) {
          onSuccessCallback();
        } else {
          startTransition(() => {
            router.refresh();
          });
        }
      } else if (result.status === "conflict") {
        setPendingConflict({
          conflicts: result.conflicts,
          resolutions: conflictResolutions,
          onSuccessCallback,
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

  const handleResolveAllocationConflict = (resolution: AllocationConflictResolution) => {
    if (!pendingConflict) return;
    const conflict = pendingConflict.conflicts[0];
    if (!conflict) return;
    const nextResolutions = {
      ...pendingConflict.resolutions,
      [`${conflict.productId}:${conflict.storeId}`]: {
        resolution,
        fingerprint: conflict.fingerprint,
      },
    };
    const onSuccessCallback = pendingConflict.onSuccessCallback;
    setPendingConflict(null);
    void handleSaveAllocations(onSuccessCallback, nextResolutions);
  };

  // Adiciona produto do catálogo usando o snapshot canônico do ciclo carregado
  // junto com o item. Fornecedor não interfere na quantidade original pedida.
  const handleAddProductFromCatalog = (item: CatalogSearchItem) => {
    if (products.some((p) => p.productId === item.id)) {
      setShowAddProductModal(false);
      return;
    }

    const newStoreAllocations: Record<string, StoreAllocationData> = {};
    const orderedQtyList: string[] = [];
    const destinedQtyList: string[] = [];

    for (const store of stores) {
      const orderQty = roundToTwoDecimals(item.orderedQuantities?.[store.id] ?? "0.00");
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
        persistedDestinedQuantity: null,
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

  // Confirmação explícita de compra de oportunidade (Regra B)
  const handleConfirmOpportunityPurchase = () => {
    if (!pendingOpportunityItem) return;

    const val = opportunityQuantity.replace(",", ".");
    const numVal = parseQuantity(val);

    if (numVal <= 0) {
      setOpportunityError("A quantidade destinada deve ser maior que zero.");
      return;
    }

    const item = pendingOpportunityItem;
    if (products.some((p) => p.productId === item.id)) {
      setPendingOpportunityItem(null);
      setShowAddProductModal(false);
      return;
    }

    const newStoreAllocations: Record<string, StoreAllocationData> = {};
    const orderedQtyList: string[] = [];
    const destinedQtyList: string[] = [];

    for (const store of stores) {
      const orderQty = roundToTwoDecimals(item.orderedQuantities?.[store.id] ?? "0.00");
      const isTargetStore = store.id === activeStoreId;
      const destinedQty = isTargetStore ? roundToTwoDecimals(numVal) : "0.00";
      const diff = calculateDifference(destinedQty, orderQty);

      newStoreAllocations[store.id] = {
        storeId: store.id,
        storeName: store.name,
        storeSlug: store.slug,
        orderedQuantity: "0.00",
        destinedQuantity: destinedQty,
        persistedDestinedQuantity: null,
        difference: diff,
        isAdditionalPurchase: isTargetStore,
      };

      orderedQtyList.push(orderQty);
      destinedQtyList.push(destinedQty);
    }

    const totalOrdered = sumQuantities(orderedQtyList);
    const totalDestined = sumQuantities(destinedQtyList);
    const totalDiff = calculateDifference(totalDestined, totalOrdered);

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
      purchasedInCosts: false,
      isAdditionalPurchase: true,
      isOpportunityConfirmed: true,
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
    setPendingOpportunityItem(null);
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

  // Handlers para ações Store-First e Decisões de Fornecedor
  const handleSetNotPurchased = (productId: string) => {
    if (isClosed || !selectedSupplierId) return;
    const prod = products.find((p) => p.productId === productId);
    if (!prod) return;
    const storeData = prod.stores[activeStoreId];
    const persistedQty = storeData?.persistedDestinedQuantity;
    if (persistedQty && parseQuantity(persistedQty) > 0) {
      setProductToReject({
        productId,
        productName: prod.productName,
        destinedQty: persistedQty,
      });
      return;
    }
    void executeSetNotPurchased(productId, false);
  };

  const executeSetNotPurchased = async (productId: string, confirmRemoveDestined: boolean) => {
    if (!selectedSupplierId) return;
    setRejectingProduct(true);
    setErrorMessage(null);

    try {
      const result = await setProductSupplierDecisionAction({
        cycleDate,
        supplierId: selectedSupplierId,
        storeId: activeStoreId,
        productId,
        decision: "NOT_PURCHASED",
        confirmRemoveDestined,
      });

      if (result.status === "success") {
        setProducts((prev) =>
          prev.map((p) => {
            if (p.productId !== productId) return p;
            const currentStore = p.stores[activeStoreId];
            const updatedStore: StoreAllocationData = currentStore
              ? {
                  ...currentStore,
                  destinedQuantity: "0.00",
                  persistedDestinedQuantity: "0.00",
                  difference: calculateDifference("0.00", currentStore.orderedQuantity),
                }
              : {
                  storeId: activeStoreId,
                  storeName: activeStore.name,
                  storeSlug: activeStore.slug,
                  orderedQuantity: cycleStoreOrders[p.productId]?.[activeStoreId] ?? "0.00",
                  destinedQuantity: "0.00",
                  persistedDestinedQuantity: "0.00",
                  difference: calculateDifference("0.00", cycleStoreOrders[p.productId]?.[activeStoreId] ?? "0.00"),
                  isAdditionalPurchase: false,
                };

            const updatedStores = { ...p.stores, [activeStoreId]: updatedStore };
            const totalDestined = sumQuantities(Object.values(updatedStores).map((s) => s.destinedQuantity));

            return {
              ...p,
              stores: updatedStores,
              totalDestined,
              totalDifference: calculateDifference(totalDestined, p.totalOrdered),
              supplierDecision: "NOT_PURCHASED",
            };
          }),
        );
        setProductToReject(null);
        setSaveMessage("Produto marcado como não comprado deste fornecedor.");
        startTransition(() => {
          router.refresh();
        });
      } else {
        setErrorMessage(result.message);
      }
    } catch {
      setErrorMessage("Erro inesperado ao registrar decisão.");
    } finally {
      setRejectingProduct(false);
    }
  };

  const handleRevertNotPurchased = async (productId: string) => {
    if (isClosed || !selectedSupplierId) return;
    setErrorMessage(null);

    try {
      const result = await revertProductSupplierDecisionAction({
        cycleDate,
        supplierId: selectedSupplierId,
        storeId: activeStoreId,
        productId,
      });

      if (result.status === "success") {
        setProducts((prev) =>
          prev.map((p) => (p.productId === productId ? { ...p, supplierDecision: null } : p)),
        );
        setSaveMessage("Decisão desfeita com sucesso.");
        startTransition(() => {
          router.refresh();
        });
      } else {
        setErrorMessage(result.message);
      }
    } catch {
      setErrorMessage("Erro inesperado ao desfazer decisão.");
    }
  };

  const handleOpenBatchConcludeSupplier = () => {
    if (isDirty && canSave) {
      setErrorMessage(
        "Você possui alterações não salvas. Salve ou reverta as alterações antes de concluir a conferência deste fornecedor.",
      );
      return;
    }
    setBatchConcludeError(null);
    setShowBatchConcludeSupplierModal(true);
  };

  const handleConfirmBatchConcludeSupplier = async () => {
    if (!selectedSupplierId) return;
    setConcludingSupplier(true);
    setBatchConcludeError(null);

    const expectedProductIds = unreviewedItemsForSupplier.map((p) => p.productId);

    try {
      const result = await concludeSupplierStoreReviewAction({
        cycleDate,
        supplierId: selectedSupplierId,
        storeId: activeStoreId,
        expectedProductIds,
      });

      if (result.status === "success") {
        setShowBatchConcludeSupplierModal(false);
        setIsDirty(false);
        setProducts((prev) =>
          prev.map((p) => {
            const hasDestined =
              p.stores[activeStoreId]?.persistedDestinedQuantity !== null &&
              parseQuantity(p.stores[activeStoreId]?.persistedDestinedQuantity) > 0;
            if (!hasDestined && !p.supplierDecision) {
              return { ...p, supplierDecision: "NOT_PURCHASED" };
            }
            return p;
          }),
        );
        setSaveMessage("Conferência do fornecedor para esta loja concluída com sucesso.");
        startTransition(() => {
          router.refresh();
        });
      } else {
        setBatchConcludeError(result.message);
      }
    } catch {
      setBatchConcludeError("Erro ao concluir conferência do fornecedor.");
    } finally {
      setConcludingSupplier(false);
    }
  };

  const handleOpenStoreClosure = (storeId?: string) => {
    const sId = storeId ?? activeStoreId;
    setTargetStoreForClosure(sId);
    setStoreCloseError(null);
    setShowStoreClosureModal(true);
  };

  const handleConfirmCloseStore = async () => {
    setClosingStore(true);
    setStoreCloseError(null);

    const targetClosure = storeClosures[targetStoreForClosure] ?? activeStoreClosure;

    try {
      const result = await closeStoreCycleAction({
        cycleDate,
        storeId: targetStoreForClosure,
        expectedOrderId: targetClosure?.previewOrderId ?? targetClosure?.orderId ?? null,
        expectedOrderRevision: targetClosure?.previewOrderRevision ?? targetClosure?.orderRevision ?? null,
        expectedAllocationsHash: targetClosure?.previewAllocationsHash ?? targetClosure?.allocationsHash ?? "",
        expectedCostsHash: targetClosure?.previewCostsHash ?? targetClosure?.costsHash ?? "",
      });

      if (result.status === "success") {
        setShowStoreClosureModal(false);
        setSaveMessage("Conferência da loja finalizada com sucesso.");
        startTransition(() => {
          router.refresh();
        });
      } else {
        setStoreCloseError(result.message);
      }
    } catch {
      setStoreCloseError("Erro inesperado ao finalizar conferência da loja.");
    } finally {
      setClosingStore(false);
    }
  };

  const handleConfirmReopenStore = async () => {
    setReopeningStore(true);
    setReopenStoreError(null);

    try {
      const result = await reopenStoreCycleAction({
        cycleDate,
        storeId: targetStoreForClosure,
        reason: reopenStoreReason,
      });

      if (result.status === "success") {
        setShowReopenStoreModal(false);
        setReopenStoreReason("");
        setSaveMessage("Conferência da loja reaberta para ajustes.");
        startTransition(() => {
          router.refresh();
        });
      } else {
        setReopenStoreError(result.message);
      }
    } catch {
      setReopenStoreError("Erro inesperado ao reabrir conferência da loja.");
    } finally {
      setReopeningStore(false);
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
  const activeConflict = pendingConflict?.conflicts[0] ?? null;

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
              🔓 Reabrir Ciclo Geral
            </button>
          ) : (
            <button
              type="button"
              className={`btn ${allStoresFinalized ? "btn--success" : "btn--secondary"}`}
              onClick={() => setShowCloseModal(true)}
              title={
                allStoresFinalized
                  ? "Todas as lojas estão finalizadas. Pronto para fechar o ciclo."
                  : `Aguardando finalização das lojas: ${unclosedStores.map((s) => s.name).join(", ")}`
              }
            >
              🔒 Fechar Ciclo Geral {allStoresFinalized ? "(3/3 Lojas Finalizadas)" : `(${stores.length - unclosedStores.length}/3 Finalizadas)`}
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

      {/* NÍVEL 1: LOJA EM CONFERÊNCIA (FOCO NA LOJA ATIVA COM BOTÃO PARA TROCAR) */}
      <section className="alloc-active-store-card" aria-label="Loja em Conferência">
        <div className="alloc-active-store-card__header">
          <div className="alloc-active-store-card__main">
            <span className="alloc-step-indicator">1. LOJA ATIVA:</span>
            <div className="alloc-active-store-card__title-row">
              <h2 className="alloc-active-store-card__title">
                🏪 {activeStore.name}
              </h2>
              {activeStoreSummary?.closureStatus === "CLOSED" && !activeStoreSummary?.isStale ? (
                <span className="alloc-status-pill alloc-status-pill--closed">
                  ✓ Finalizada
                </span>
              ) : activeStoreSummary?.closureStatus === "CLOSED" && activeStoreSummary?.isStale ? (
                <span
                  className="alloc-status-pill alloc-status-pill--stale"
                  title={activeStoreSummary.staleReason ?? "Reconferir"}
                >
                  ⚠️ Reconferir
                </span>
              ) : (
                <span className="alloc-status-pill alloc-status-pill--open">
                  ⏳ Aberta
                </span>
              )}
            </div>
            <div className="alloc-active-store-card__metrics">
              <span className="alloc-metric-chip">
                Itens pedidos: <strong>{activeStoreSummary?.totalOrderedProducts ?? 0}</strong>
              </span>
              <span className="alloc-metric-chip">
                Conferidos: <strong>{activeStoreSummary?.totalReviewedProducts ?? 0}</strong>
              </span>
              <span
                className={`alloc-metric-chip ${
                  activeStoreSummary?.totalPendingProducts
                    ? "alloc-metric-chip--pending"
                    : "alloc-metric-chip--success"
                }`}
              >
                Pendências:{" "}
                <strong>{activeStoreSummary?.totalPendingProducts ?? 0}</strong>
              </span>
              <span className="alloc-metric-chip alloc-metric-chip--destined">
                Total destinado:{" "}
                <strong>{activeStoreSummary?.totalDestinedQuantity ?? "0.00"} CX</strong>
              </span>
            </div>
          </div>

          <div className="alloc-active-store-card__actions">
            <button
              type="button"
              className="btn btn--secondary"
              style={{ fontSize: "13px", minHeight: "36px", padding: "6px 14px", fontWeight: "700" }}
              onClick={() => setShowStoreSelectModal(true)}
              title="Abrir modal para selecionar outra loja"
            >
              🔄 Trocar Loja
            </button>
            {activeStoreSummary?.closureStatus === "CLOSED" ? (
              <button
                type="button"
                className="btn btn--secondary"
                style={{ fontSize: "12px", minHeight: "36px", padding: "6px 12px" }}
                onClick={() => handleOpenStoreClosure(activeStoreId)}
              >
                📋 Ver Cortes da Loja
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--primary"
                style={{
                  fontSize: "12px",
                  minHeight: "36px",
                  padding: "6px 12px",
                  backgroundColor: "#0284c7",
                }}
                onClick={() => handleOpenStoreClosure(activeStoreId)}
              >
                🏁 Conferir Cortes e Finalizar Loja
              </button>
            )}
          </div>
        </div>
      </section>

      {/* NÍVEL 2: SELEÇÃO DO FORNECEDOR (LOGO ABAIXO DA LOJA) */}
      <section className="alloc-supplier-section" aria-label="Seleção do Fornecedor">
        <div className="alloc-supplier-section__header">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
            <div className="alloc-step-indicator">
              2. FORNECEDOR (PARA {activeStore.name.toUpperCase()}):
            </div>
            {selectedSupplier ? (
              selectedSupplier.reviewedByStore?.[activeStoreId] ? (
                <span className="alloc-supplier-review-badge alloc-supplier-review-badge--reviewed">
                  ✓ Fornecedor conferido nesta loja
                </span>
              ) : (
                <span className="alloc-supplier-review-badge alloc-supplier-review-badge--pending">
                  ⏳ Conferência pendente nesta loja
                </span>
              )
            ) : null}
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
                const isRev = s.reviewedByStore?.[activeStoreId];
                return (
                  <option key={s.id} value={s.id}>
                    {isRev ? "✓ " : ""}{s.corporateName} {s.tradeName ? `(${s.tradeName})` : ""} — {storeVol} CX {isRev ? "(Conferido)" : ""}
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
              <div className="alloc-supplier-actions" style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                {currentSupplierInvoices.length > 0 ? (
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    style={{
                      fontSize: "12px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                      backgroundColor: "#f0fdf4",
                      color: "#166534",
                      borderColor: "#86efac",
                      fontWeight: 600,
                    }}
                    onClick={() => setShowViewInvoicesModal(true)}
                    title="Clique para visualizar as fotos das notas registradas"
                  >
                    📄 {currentSupplierInvoices.length === 1 ? `NF ${currentSupplierInvoices[0].invoiceNumber}` : `${currentSupplierInvoices.length} Notas`} (Ver fotos)
                  </button>
                ) : parseQuantity(activeStoreTotalDestined) > 0 ? (
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      backgroundColor: "#fef3c7",
                      color: "#92400e",
                      padding: "4px 8px",
                      borderRadius: "6px",
                      border: "1px solid #fde68a",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    ⚠️ Sem Nota
                  </span>
                ) : null}

                {!isClosed ? (
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    style={{ fontSize: "12px", display: "inline-flex", alignItems: "center", gap: "4px" }}
                    onClick={handleOpenRegisterInvoice}
                  >
                    {currentSupplierInvoices.length > 0 ? "+ Adicionar NF" : "📄 Registrar Nota"}
                  </button>
                ) : null}

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
              {activeSupplierReview ? (
                <span className="alloc-meta-item" style={{ color: "#166534", backgroundColor: "#dcfce7", padding: "2px 8px", borderRadius: "9999px", fontWeight: 600 }}>
                  ✓ Conferência concluída para {activeStore.name.replace("MultiShow ", "")}
                </span>
              ) : null}
              {currentSupplierInvoices.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowViewInvoicesModal(true)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  <span className="alloc-meta-item" style={{ color: "#15803d", backgroundColor: "#dcfce7", padding: "2px 8px", borderRadius: "9999px", fontWeight: 600 }}>
                    ✓ {currentSupplierInvoices.length} Nota(s) vinculada(s)
                  </span>
                </button>
              ) : parseQuantity(activeStoreTotalDestined) > 0 ? (
                <span className="alloc-meta-item" style={{ color: "#b45309", backgroundColor: "#fef3c7", padding: "2px 8px", borderRadius: "9999px", fontWeight: 600 }}>
                  ⚠️ Destinação sem nota fiscal vinculada
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
                  persistedDestinedQuantity: null,
                  difference: "0.00",
                  isAdditionalPurchase: false,
                };

                const diff = storeData.difference;
                const isSurplus = diff.startsWith("+") && diff !== "+0.00";
                const isCut = diff.startsWith("-");
                const hasOrder = parseQuantity(storeData.orderedQuantity) > 0;
                const isDifferentFromOrder =
                  hasOrder && storeData.destinedQuantity !== storeData.orderedQuantity;
                const isUnpurchasedWithOrders =
                  !prod.purchasedInCosts && parseQuantity(prod.totalOrdered) > 0;
                const hasDestinedInActiveStore =
                  parseQuantity(storeData.destinedQuantity) > 0;

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
                          {isUnpurchasedWithOrders ? (
                            <span
                              className="alloc-badge"
                              style={{ backgroundColor: "#fee2e2", color: "#b91c1c", fontWeight: "700" }}
                            >
                              ⚠️ Não Comprado nos Custos
                            </span>
                          ) : null}
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

                    {/* BANNER DE ALERTA: PRODUTO COM PEDIDO NÃO COMPRADO NOS CUSTOS (BUG 03) */}
                    {isUnpurchasedWithOrders ? (
                      <div className="alloc-unpurchased-alert-banner">
                        <div className="alloc-unpurchased-alert-header">
                          <span role="img" aria-label="Alerta">⚠️</span>
                          <span>PRODUTO NÃO COMPRADO NOS CUSTOS</span>
                        </div>
                        <p className="alloc-unpurchased-alert-text">
                          Este produto possui pedido das lojas ({prod.totalOrdered} {prod.purchaseFormat}), mas não foi marcado como comprado na tela de custos. Para destiná-lo, marque-o como comprado nos custos primeiro.
                        </p>
                        {hasDestinedInActiveStore ? (
                          <div className="alloc-unpurchased-alert-action-row">
                            <span className="alloc-unpurchased-alert-destined-warning">
                              Destinação indevida nesta loja: <strong>{storeData.destinedQuantity} {prod.purchaseFormat}</strong>
                            </span>
                            <button
                              type="button"
                              className="btn btn--danger alloc-btn-zero"
                              onClick={() => handleQuantityChange(prod.productId, "0.00")}
                              title="Zerar destinação indevida"
                            >
                              Zerar Destinação
                            </button>
                          </div>
                        ) : (
                          <div className="alloc-unpurchased-alert-cleared">
                            ✓ Destinação zerada nesta loja.
                          </div>
                        )}
                      </div>
                    ) : null}

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
                          {prod.storeTotalDestinedAcrossSuppliers && parseQuantity(prod.storeTotalDestinedAcrossSuppliers) > 0 ? (
                            <span style={{ fontSize: "11px", color: "#0369a1", display: "block", marginTop: "3px" }}>
                              Total destinado somando fornecedores: <strong>{prod.storeTotalDestinedAcrossSuppliers} {prod.purchaseFormat}</strong>
                            </span>
                          ) : null}
                        </div>
                      </div>

                      {/* Decisão explícita de Não Comprado */}
                      {prod.supplierDecision === "NOT_PURCHASED" ? (
                        <div className="alloc-not-purchased-banner">
                          <span className="alloc-not-purchased-banner__text">
                            🚫 Não comprado deste fornecedor nesta loja
                          </span>
                          {!isClosed ? (
                            <button
                              type="button"
                              className="alloc-btn-revert"
                              onClick={() => handleRevertNotPurchased(prod.productId)}
                              title="Reverter decisão e permitir nova compra ou destinação"
                            >
                              Desfazer Decisão
                            </button>
                          ) : null}
                        </div>
                      ) : null}

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
                            disabled={isClosed || (isUnpurchasedWithOrders && !hasDestinedInActiveStore)}
                            value={storeData.destinedQuantity}
                            onChange={(e) =>
                              handleQuantityChange(prod.productId, e.target.value)
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                const inputs = Array.from(document.querySelectorAll<HTMLInputElement>(".alloc-stepper-input"));
                                const currentIndex = inputs.indexOf(e.currentTarget);
                                if (currentIndex >= 0 && currentIndex < inputs.length - 1) {
                                  inputs[currentIndex + 1]?.focus();
                                  inputs[currentIndex + 1]?.select();
                                }
                              }
                            }}
                          />
                          <button
                            type="button"
                            className="alloc-stepper-btn"
                            disabled={isClosed || isUnpurchasedWithOrders}
                            aria-label={`Aumentar quantidade`}
                            onClick={() => handleStepQuantity(prod.productId, 1)}
                            title={isUnpurchasedWithOrders ? "Bloqueado: marque como comprado nos custos" : undefined}
                          >
                            +
                          </button>
                        </div>

                        {/* Botão Individual: NÃO COMPREI DESTE FORNECEDOR */}
                        {prod.supplierDecision !== "NOT_PURCHASED" && !isClosed ? (
                          <button
                            type="button"
                            className="alloc-btn-not-purchased"
                            title="Registrar decisão de não comprar deste fornecedor para esta loja"
                            onClick={() => handleSetNotPurchased(prod.productId)}
                          >
                            Não comprei deste fornecedor
                          </button>
                        ) : null}

                        {/* Botão de Sugestão Tátil de Pedido */}
                        {isDifferentFromOrder && !isClosed && !isUnpurchasedWithOrders ? (
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

          {/* AÇÃO EM LOTE DO FORNECEDOR */}
          {!isClosed && selectedSupplierId && filteredProducts.length > 0 ? (
            <div className="alloc-batch-conclude-card">
              <div className="alloc-batch-conclude-card__info">
                <h4>Concluir Conferência deste Fornecedor</h4>
                <p>
                  Marca os produtos sem destinação nesta loja como &quot;Não comprado deste fornecedor&quot; e conclui a conferência de <strong>{selectedSupplier?.corporateName}</strong> para <strong>{activeStore.name}</strong>.
                </p>
              </div>
              <button
                type="button"
                className="btn btn--secondary"
                style={{ fontWeight: "700", whiteSpace: "nowrap" }}
                onClick={handleOpenBatchConcludeSupplier}
              >
                Concluir Conferência deste Fornecedor ❯
              </button>
            </div>
          ) : null}

          {/* BARRA FIXA DE SALVAR DA LOJA ATIVA */}
          {!isClosed ? (
            <div className="alloc-sticky-bar">
              <div className="alloc-sticky-info">
                <div className="alloc-sticky-store">
                  🏪 <strong>{activeStore.name.replace("MultiShow ", "")}</strong> •{" "}
                  <span>{activeStoreTotalDestined} CX</span>
                </div>
                <span className="alloc-sticky-status">
                  {isDirty && canSave ? (
                    <strong style={{ color: "#d97706" }}>⚠️ Alterações não salvas</strong>
                  ) : hasUnconfirmedSuggestions ? (
                    <strong style={{ color: "#d97706" }}>⚠️ Sugestões aguardando confirmação</strong>
                  ) : (
                    <span style={{ color: "#16a34a" }}>✓ Todas as alterações salvas</span>
                  )}
                </span>
              </div>

              <div className="alloc-sticky-buttons">
                <button
                  type="button"
                  className="btn btn--secondary"
                  style={{ fontWeight: "700" }}
                  onClick={() => handleOpenStoreClosure(activeStoreId)}
                >
                  Conferir Cortes da Loja
                </button>

                <button
                  type="button"
                  className="btn btn--primary alloc-save-btn"
                  disabled={saving || !canSave}
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

      {/* MODAL: DESTINAÇÃO POSITIVA JÁ EXISTENTE EM OUTRO FORNECEDOR */}
      {activeConflict ? (
        <div
          className="alloc-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="allocation-conflict-title"
        >
          <div className="alloc-modal alloc-conflict-modal">
            <header className="alloc-modal__header">
              <div>
                <h2 id="allocation-conflict-title">Confirmar destinação entre fornecedores</h2>
                <p className="alloc-conflict-subtitle">
                  [{activeConflict.erpCode}] {activeConflict.productName} — {activeConflict.storeName}
                </p>
              </div>
              <button
                type="button"
                className="btn btn--secondary"
                aria-label="Cancelar conflito de destinação"
                onClick={() => setPendingConflict(null)}
              >
                ✕
              </button>
            </header>
            <div className="alloc-modal__body">
              <p className="alloc-conflict-warning">
                Este produto já possui quantidade positiva em outro fornecedor. Escolha
                explicitamente se a compra será transferida ou realmente dividida.
              </p>
              <dl className="alloc-conflict-summary">
                <div>
                  <dt>Pedido original da loja</dt>
                  <dd>{activeConflict.orderedQuantity} {activeConflict.purchaseFormat}</dd>
                </div>
                <div>
                  <dt>Total já destinado</dt>
                  <dd>{activeConflict.totalAlreadyDestined} {activeConflict.purchaseFormat}</dd>
                </div>
                <div>
                  <dt>Quantidade adicional pretendida</dt>
                  <dd>{activeConflict.intendedQuantity} {activeConflict.purchaseFormat}</dd>
                </div>
              </dl>
              <div className="alloc-conflict-suppliers">
                <strong>Quantidade atual por fornecedor</strong>
                <ul>
                  {activeConflict.allocations.map((allocation) => (
                    <li key={allocation.supplierId}>
                      <span>{allocation.supplierName}</span>
                      <strong>{allocation.destinedQuantity} {activeConflict.purchaseFormat}</strong>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="alloc-conflict-help">
                A compra dividida pode ultrapassar o pedido original quando houver corte,
                complemento ou decisão comercial. Ela será registrada na auditoria.
              </p>
            </div>
            <footer className="alloc-modal__footer alloc-conflict-actions">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setPendingConflict(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => handleResolveAllocationConflict("TRANSFER")}
              >
                Transferir destinação anterior
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => handleResolveAllocationConflict("SPLIT_CONFIRMED")}
              >
                Confirmar compra dividida
              </button>
            </footer>
          </div>
        </div>
      ) : null}

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
                  {closure.missingStores && closure.missingStores.length > 0 ? (
                    <div style={{ marginTop: "8px" }}>
                      <p style={{ margin: "2px 0 6px 0", fontSize: "12px", fontWeight: "700", color: "#991b1b" }}>
                        Lojas pendentes de conferência de cortes ou desatualizadas ({closure.missingStores.length}):
                      </p>
                      <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "12px", color: "#7f1d1d" }}>
                        {closure.missingStores.map((s) => (
                          <li key={s.id} style={{ marginBottom: "4px" }}>
                            <strong>{s.name}</strong>: {s.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {closure.missingProducts && closure.missingProducts.length > 0 ? (
                    <div style={{ marginTop: "8px" }}>
                      <p style={{ margin: "2px 0 6px 0", fontSize: "12px", fontWeight: "700", color: "#991b1b" }}>
                        Produtos comprados nos custos sem destinação ({closure.missingProducts.length}):
                      </p>
                      <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "12px", color: "#7f1d1d" }}>
                        {closure.missingProducts.map((p) => (
                          <li key={p.id}>
                            [{p.erpCode}] {p.name}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p style={{ color: "#166534", fontWeight: "600" }}>
                  ✓ Todas as lojas ({stores.length}) foram conferidas e finalizadas sem pendências, e todos os produtos comprados possuem destinação atribuída.
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

                      const orderForActiveStore = roundToTwoDecimals(
                        item.orderedQuantities?.[activeStoreId] ?? "0.00",
                      );
                      const hasOrderInActive = parseQuantity(orderForActiveStore) > 0;
                      const totalCycleOrdersNum = parseQuantity(item.totalCycleOrders ?? "0");
                      const isPurchased = Boolean(item.purchasedInCosts);
                      const isOrderedUnpurchased = !isPurchased && totalCycleOrdersNum > 0;
                      const isOpportunity = !isPurchased && totalCycleOrdersNum === 0;

                      return (
                        <li
                          key={item.id}
                          className="alloc-modal-catalog-item"
                          style={{
                            backgroundColor: isExclusiveToOther
                              ? "#fff7ed"
                              : isOrderedUnpurchased
                              ? "#fef2f2"
                              : "#fff",
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: "700", fontSize: "14px" }}>
                              [{item.erpCode}] {item.name}
                            </div>
                            <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                              Formato: {item.purchaseFormat}
                              {isExclusiveToOther ? (
                                <span style={{ color: "#c2410c", marginLeft: "6px", fontWeight: "600" }}>
                                  (Exclusivo: {item.exclusiveSupplierName ?? "Outro fornecedor"})
                                </span>
                              ) : null}
                            </div>

                            {/* Detalhamento de compra e pedidos (Bug 03 - Regras A, B e C) */}
                            {isOrderedUnpurchased ? (
                              <div
                                style={{
                                  fontSize: "12px",
                                  color: "#b91c1c",
                                  marginTop: "4px",
                                  backgroundColor: "#fee2e2",
                                  padding: "6px 8px",
                                  borderRadius: "6px",
                                  lineHeight: "1.4",
                                }}
                              >
                                ⚠️ <strong>Não comprado nos custos:</strong> Este produto possui pedido das lojas ({item.totalCycleOrders} {item.purchaseFormat}), mas não foi marcado como comprado na tela de custos. Para destiná-lo, marque-o como comprado nos custos primeiro.
                              </div>
                            ) : isOpportunity ? (
                              <div style={{ fontSize: "12px", color: "#b45309", marginTop: "3px" }}>
                                ⚡ Sem pedido nas lojas neste ciclo (Compra de Oportunidade)
                              </div>
                            ) : (
                              <div style={{ fontSize: "12px", color: "#166534", marginTop: "3px" }}>
                                ✓ Comprado nos custos
                                {hasOrderInActive ? (
                                  <span style={{ marginLeft: "6px", fontWeight: "600" }}>
                                    • Pedido {activeStore.name.replace("MultiShow ", "")}: {orderForActiveStore} {item.purchaseFormat}
                                  </span>
                                ) : (
                                  <span style={{ marginLeft: "6px", color: "#64748b" }}>
                                    • Sem pedido nesta unidade
                                  </span>
                                )}
                              </div>
                            )}
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            {isExclusiveToOther ? (
                              <button
                                type="button"
                                className="btn btn--secondary"
                                style={{ minHeight: "34px", padding: "4px 12px", fontSize: "12px" }}
                                disabled
                              >
                                Bloqueado
                              </button>
                            ) : isOrderedUnpurchased ? (
                              <button
                                type="button"
                                className="btn btn--secondary"
                                style={{
                                  minHeight: "34px",
                                  padding: "4px 12px",
                                  fontSize: "12px",
                                  color: "#dc2626",
                                  borderColor: "#fca5a5",
                                }}
                                disabled
                                title="Bloqueado: produto com pedido não comprado nos custos"
                              >
                                Bloqueado
                              </button>
                            ) : isOpportunity ? (
                              <button
                                type="button"
                                className="btn btn--primary"
                                style={{
                                  minHeight: "34px",
                                  padding: "4px 12px",
                                  fontSize: "13px",
                                  backgroundColor: "#d97706",
                                  borderColor: "#b45309",
                                }}
                                onClick={() => {
                                  setPendingOpportunityItem(item);
                                  setOpportunityQuantity("1");
                                  setOpportunityError(null);
                                }}
                              >
                                + Oportunidade
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn btn--primary"
                                style={{ minHeight: "34px", padding: "4px 12px", fontSize: "13px" }}
                                onClick={() => handleAddProductFromCatalog(item)}
                              >
                                + Adicionar
                              </button>
                            )}
                          </div>
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

      {/* MODAL: CONFIRMAR COMPRA DE OPORTUNIDADE (REGRA B) */}
      {pendingOpportunityItem ? (
        <div className="alloc-modal-backdrop" role="dialog" aria-modal="true">
          <div className="alloc-modal" style={{ maxWidth: "480px" }}>
            <header className="alloc-modal__header">
              <h2>Confirmar Compra de Oportunidade</h2>
              <button
                type="button"
                className="btn btn--secondary"
                style={{ minHeight: "32px", padding: "4px 8px" }}
                onClick={() => {
                  setPendingOpportunityItem(null);
                  setOpportunityError(null);
                }}
              >
                ✕
              </button>
            </header>
            <div className="alloc-modal__body">
              <div className="alloc-opp-item-info">
                <span className="alloc-opp-item-erp">[{pendingOpportunityItem.erpCode}]</span>
                <strong className="alloc-opp-item-name">{pendingOpportunityItem.name}</strong>
                <span className="alloc-opp-item-format">({pendingOpportunityItem.purchaseFormat})</span>
              </div>

              <div className="alloc-opp-store-target">
                Destinação para: <strong>{activeStore.name}</strong>
              </div>

              <div className="alloc-opp-notice">
                <strong>Nenhuma loja solicitou este produto neste ciclo.</strong>
                <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#92400e" }}>
                  A inclusão será registrada como compra de oportunidade para {activeStore.name} e fará parte do fechamento operacional, sem necessidade de custo prévio na tela de custos.
                </p>
              </div>

              <div className="alloc-opp-input-group">
                <label
                  htmlFor="opp-quantity"
                  style={{ fontWeight: "700", fontSize: "13px", display: "block", marginBottom: "6px" }}
                >
                  Quantidade Destinada ({pendingOpportunityItem.purchaseFormat}) * obrigatória e maior que zero
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <button
                    type="button"
                    className="alloc-stepper-btn"
                    onClick={() => {
                      const cur = parseQuantity(opportunityQuantity);
                      if (cur > 1) {
                        setOpportunityQuantity(String(cur - 1));
                        setOpportunityError(null);
                      }
                    }}
                  >
                    −
                  </button>
                  <input
                    id="opp-quantity"
                    type="text"
                    inputMode="decimal"
                    className="alloc-stepper-input"
                    style={{ width: "100px", height: "42px", fontSize: "16px" }}
                    value={opportunityQuantity}
                    onChange={(e) => {
                      setOpportunityQuantity(e.target.value);
                      setOpportunityError(null);
                    }}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="alloc-stepper-btn"
                    onClick={() => {
                      const cur = parseQuantity(opportunityQuantity);
                      setOpportunityQuantity(String(cur + 1));
                      setOpportunityError(null);
                    }}
                  >
                    +
                  </button>
                </div>
                {opportunityError ? (
                  <div style={{ color: "#dc2626", fontSize: "12px", marginTop: "6px", fontWeight: "600" }}>
                    ⚠️ {opportunityError}
                  </div>
                ) : null}
              </div>
            </div>
            <footer className="alloc-modal__footer">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => {
                  setPendingOpportunityItem(null);
                  setOpportunityError(null);
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn--success"
                onClick={handleConfirmOpportunityPurchase}
              >
                Confirmar Inclusão
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {/* MODAL: CONFIRMAR REMOÇÃO DE DESTINAÇÃO POSITIVA AO MARCAR NÃO COMPRADO */}
      {productToReject ? (
        <div className="alloc-modal-backdrop" role="dialog" aria-modal="true">
          <div className="alloc-modal" style={{ maxWidth: "480px" }}>
            <header className="alloc-modal__header">
              <h2>Zerar Destinação e Marcar Não Comprado?</h2>
              <button
                type="button"
                className="btn btn--secondary"
                style={{ minHeight: "32px", padding: "4px 8px" }}
                onClick={() => setProductToReject(null)}
              >
                ✕
              </button>
            </header>
            <div className="alloc-modal__body">
              <div style={{ backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", padding: "12px", marginBottom: "12px" }}>
                <p style={{ margin: 0, fontSize: "14px", color: "#991b1b", fontWeight: "600" }}>
                  ⚠️ Atenção: O produto <u>{productToReject.productName}</u> possui <strong>{productToReject.destinedQty} CX</strong> destinadas para {activeStore.name} neste fornecedor.
                </p>
                <p style={{ margin: "6px 0 0 0", fontSize: "12px", color: "#7f1d1d" }}>
                  Confirmar esta ação irá zerar a destinação salva para este fornecedor e registrá-lo como não comprado. Compras em outros fornecedores serão mantidas intactas.
                </p>
              </div>
              <p style={{ fontSize: "13px", color: "#475569" }}>
                Deseja realmente remover a destinação salva e marcar o produto como &quot;Não comprado deste fornecedor&quot;?
              </p>
            </div>
            <footer className="alloc-modal__footer">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setProductToReject(null)}
              >
                Cancelar (Manter Destinação)
              </button>
              <button
                type="button"
                className="btn btn--danger"
                disabled={rejectingProduct}
                onClick={() => void executeSetNotPurchased(productToReject.productId, true)}
              >
                {rejectingProduct ? "Removendo..." : "Sim, Zerar e Marcar Não Comprado"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {/* MODAL: CONCLUIR CONFERÊNCIA EM LOTE DO FORNECEDOR */}
      {showBatchConcludeSupplierModal ? (
        <div className="alloc-modal-backdrop" role="dialog" aria-modal="true">
          <div className="alloc-modal" style={{ maxWidth: "560px" }}>
            <header className="alloc-modal__header">
              <h2>Concluir Conferência deste Fornecedor</h2>
              <button
                type="button"
                className="btn btn--secondary"
                style={{ minHeight: "32px", padding: "4px 8px" }}
                onClick={() => {
                  setShowBatchConcludeSupplierModal(false);
                  setBatchConcludeError(null);
                }}
              >
                ✕
              </button>
            </header>
            <div className="alloc-modal__body">
              <div style={{ display: "flex", gap: "10px", marginBottom: "12px", fontSize: "13px" }}>
                <div>Fornecedor: <strong>{activeSupplier?.corporateName}</strong></div>
                <div>•</div>
                <div>Loja: <strong>{activeStore.name}</strong></div>
              </div>

              <div style={{ backgroundColor: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px", marginBottom: "12px" }}>
                <p style={{ margin: 0, fontSize: "13px", color: "#334155" }}>
                  Esta ação identificará os produtos elegíveis ainda sem decisão para <strong>{activeStore.name}</strong> neste fornecedor e os marcará em lote como &quot;Não comprado deste fornecedor&quot;.
                </p>
                <div style={{ marginTop: "8px", fontSize: "12px", color: "#166534", fontWeight: "600" }}>
                  ✓ Destinações positivas salvas ({positiveDestinedCountForSupplier} itens) serão integralmente preservadas.
                </div>
                <div style={{ fontSize: "12px", color: "#475569", marginTop: "4px" }}>
                  ✓ Não altera decisões de outras lojas nem de outros fornecedores.
                </div>
              </div>

              {unreviewedItemsForSupplier.length > 0 ? (
                <div>
                  <div style={{ fontSize: "12px", fontWeight: "700", color: "#475569", marginBottom: "6px" }}>
                    Produtos restantes que serão marcados como &quot;Não comprado&quot; ({unreviewedItemsForSupplier.length}):
                  </div>
                  <div style={{ maxHeight: "160px", overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "8px", backgroundColor: "#fff" }}>
                    <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "12px", color: "#334155" }}>
                      {unreviewedItemsForSupplier.map((p) => (
                        <li key={p.productId} style={{ marginBottom: "2px" }}>
                          [{p.erpCode}] {p.productName}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: "13px", color: "#166534", fontWeight: "600" }}>
                  ✓ Todos os produtos deste fornecedor para esta loja já possuem destinação positiva ou decisão registrada!
                </div>
              )}

              {batchConcludeError ? (
                <div style={{ color: "#dc2626", fontSize: "13px", marginTop: "8px" }}>
                  ⚠️ {batchConcludeError}
                </div>
              ) : null}
            </div>
            <footer className="alloc-modal__footer">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => {
                  setShowBatchConcludeSupplierModal(false);
                  setBatchConcludeError(null);
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={concludingSupplier}
                onClick={handleConfirmBatchConcludeSupplier}
              >
                {concludingSupplier ? "Concluindo..." : "Confirmar Conclusão do Fornecedor"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {/* MODAL: CONFERÊNCIA CONJUNTA DOS CORTES DA LOJA */}
      {showStoreClosureModal ? (
        <div className="alloc-modal-backdrop" role="dialog" aria-modal="true">
          <div className="alloc-modal" style={{ maxWidth: "800px", width: "95%" }}>
            <header className="alloc-modal__header">
              <div>
                <h2 style={{ margin: 0 }}>
                  Conferência Conjunta dos Cortes — {targetStore.name}
                </h2>
                <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                  {targetStoreClosure?.status === "CLOSED" && !targetStoreClosure.isStale ? (
                    <span style={{ color: "#15803d", fontWeight: "700" }}>
                      ✓ Loja Finalizada em {targetStoreClosure.closedAt ? new Date(targetStoreClosure.closedAt).toLocaleString("pt-BR") : ""} por {targetStoreClosure.closedByName ?? "Comprador"}
                    </span>
                  ) : targetStoreClosure?.status === "CLOSED" && targetStoreClosure.isStale ? (
                    <span style={{ color: "#b91c1c", fontWeight: "700" }}>
                      ⚠️ Conferência Desatualizada: {targetStoreClosure.staleReason ?? "Houve alterações posteriores"}. Necessário reconfirmar.
                    </span>
                  ) : (
                    <span style={{ color: "#0284c7", fontWeight: "600" }}>
                      Conferência pendente de finalização
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                className="btn btn--secondary"
                style={{ minHeight: "32px", padding: "4px 8px" }}
                onClick={() => {
                  setShowStoreClosureModal(false);
                  setStoreCloseError(null);
                }}
              >
                ✕
              </button>
            </header>

            <div className="alloc-modal__body" style={{ maxHeight: "65vh", overflowY: "auto" }}>
              {/* Cards de Resumo */}
              <div className="alloc-summary-grid">
                <div className="alloc-summary-card">
                  <div className="alloc-summary-card__label">Itens Pedidos</div>
                  <div className="alloc-summary-card__value">
                    {targetStoreClosure?.totalOrderedItems ?? 0}
                  </div>
                </div>
                <div className="alloc-summary-card">
                  <div className="alloc-summary-card__label">Itens Destinados</div>
                  <div className="alloc-summary-card__value" style={{ color: "#15803d" }}>
                    {targetStoreClosure?.totalDestinedItems ?? 0}
                  </div>
                </div>
                <div className="alloc-summary-card">
                  <div className="alloc-summary-card__label">Cortes (Totais / Parciais)</div>
                  <div className="alloc-summary-card__value" style={{ color: (targetStoreClosure?.totalCutItems ?? 0) > 0 ? "#b91c1c" : "#64748b" }}>
                    {targetStoreClosure?.totalCutItems ?? 0}
                  </div>
                </div>
              </div>

              {/* Nota Explicativa das Regras 5 e 6 */}
              <div style={{ margin: "12px 0", padding: "10px", backgroundColor: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", fontSize: "12px", color: "#475569" }}>
                <strong>Regra de Conferência:</strong> A destinação abaixo soma todos os fornecedores para esta loja. Ao confirmar a finalização, é gerado um snapshot imutável auditável vinculado à revisão do pedido. Se pedidos ou destinações forem alterados posteriormente, a conferência será invalidada automaticamente para exigir nova revisão.
              </div>

              {/* Tabela de Cortes */}
              <div style={{ overflowX: "auto" }}>
                <table className="alloc-cuts-table" style={{ width: "100%", textAlign: "left" }}>
                  <thead>
                    <tr>
                      <th style={{ width: "40%" }}>Produto</th>
                      <th style={{ textAlign: "right" }}>Qtd Pedida</th>
                      <th style={{ textAlign: "right" }}>Qtd Destinada</th>
                      <th style={{ textAlign: "center" }}>Situação / Corte</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(targetStoreClosure?.cuts ?? []).length > 0 ? (
                      targetStoreClosure!.cuts.map((cut) => {
                        let badgeClass = "alloc-cut-pill--fulfilled";
                        let badgeLabel = `Integral (${cut.destinedQuantity} ${cut.purchaseFormat})`;

                        if (cut.status === "TOTAL_CUT") {
                          badgeClass = "alloc-cut-pill--total";
                          badgeLabel = `Corte Total (-${cut.cutQuantity} ${cut.purchaseFormat})`;
                        } else if (cut.status === "PARTIAL_CUT") {
                          badgeClass = "alloc-cut-pill--partial";
                          badgeLabel = `Corte Parcial (-${cut.cutQuantity} ${cut.purchaseFormat})`;
                        } else if (cut.status === "ADDITIONAL") {
                          badgeClass = "alloc-cut-pill--additional";
                          badgeLabel = `Adicional (+${cut.destinedQuantity} ${cut.purchaseFormat})`;
                        }

                        return (
                          <tr key={cut.productId}>
                            <td>
                              <span style={{ color: "#64748b", fontFamily: "monospace", fontSize: "11px", marginRight: "4px" }}>
                                [{cut.erpCode}]
                              </span>
                              <strong style={{ fontSize: "13px" }}>{cut.productName}</strong>
                            </td>
                            <td style={{ textAlign: "right", fontFamily: "monospace", fontSize: "13px" }}>
                              {cut.orderedQuantity} {cut.purchaseFormat}
                            </td>
                            <td style={{ textAlign: "right", fontFamily: "monospace", fontSize: "13px", fontWeight: "700" }}>
                              {cut.destinedQuantity} {cut.purchaseFormat}
                            </td>
                            <td style={{ textAlign: "center" }}>
                              <span className={`alloc-cut-pill ${badgeClass}`}>
                                {badgeLabel}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={4} style={{ textAlign: "center", padding: "20px", color: "#64748b" }}>
                          Nenhum produto pedido ou destinado para esta loja neste ciclo.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {storeCloseError ? (
                <div style={{ color: "#dc2626", fontSize: "13px", marginTop: "12px", fontWeight: "600" }}>
                  ⚠️ {storeCloseError}
                </div>
              ) : null}
            </div>

            <footer className="alloc-modal__footer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                {targetStoreClosure?.status === "CLOSED" && !targetStoreClosure.isStale && !isClosed ? (
                  <button
                    type="button"
                    className="btn btn--secondary"
                    style={{ color: "#b91c1c" }}
                    onClick={() => {
                      setShowStoreClosureModal(false);
                      setShowReopenStoreModal(true);
                    }}
                  >
                    🔓 Reabrir Conferência desta Loja
                  </button>
                ) : null}
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => {
                    setShowStoreClosureModal(false);
                    setStoreCloseError(null);
                  }}
                >
                  Fechar
                </button>
                {!isClosed ? (
                  <button
                    type="button"
                    className="btn btn--success"
                    disabled={closingStore}
                    onClick={handleConfirmCloseStore}
                  >
                    {closingStore
                      ? "Finalizando..."
                      : targetStoreClosure?.status === "CLOSED" && targetStoreClosure.isStale
                      ? "Reconfirmar Cortes e Finalizar Loja"
                      : "Confirmar Cortes e Finalizar Loja"}
                  </button>
                ) : null}
              </div>
            </footer>
          </div>
        </div>
      ) : null}

      {/* MODAL: REABRIR CONFERÊNCIA DA LOJA */}
      {showReopenStoreModal ? (
        <div className="alloc-modal-backdrop" role="dialog" aria-modal="true">
          <div className="alloc-modal" style={{ maxWidth: "480px" }}>
            <header className="alloc-modal__header">
              <h2>Reabrir Conferência — {targetStore.name}</h2>
              <button
                type="button"
                className="btn btn--secondary"
                style={{ minHeight: "32px", padding: "4px 8px" }}
                onClick={() => {
                  setShowReopenStoreModal(false);
                  setReopenStoreError(null);
                }}
              >
                ✕
              </button>
            </header>
            <div className="alloc-modal__body">
              <p style={{ fontSize: "13px", color: "#475569" }}>
                A reabertura anula a finalização da loja para permitir novos lançamentos ou alterações de destinação. Por motivos de auditoria, informe a justificativa:
              </p>
              <label
                htmlFor="reopen-store-reason"
                style={{ fontSize: "12px", fontWeight: "700", color: "#475569", display: "block", marginBottom: "4px" }}
              >
                Justificativa obrigatória (mínimo 5 caracteres):
              </label>
              <textarea
                id="reopen-store-reason"
                rows={3}
                className="alloc-search-input"
                style={{ width: "100%", resize: "vertical" }}
                placeholder="Ex: Fornecedor confirmou entrega adicional de cenoura..."
                value={reopenStoreReason}
                onChange={(e) => setReopenStoreReason(e.target.value)}
              />
              {reopenStoreError ? (
                <div style={{ color: "#dc2626", fontSize: "13px", marginTop: "6px" }}>
                  ⚠️ {reopenStoreError}
                </div>
              ) : null}
            </div>
            <footer className="alloc-modal__footer">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => {
                  setShowReopenStoreModal(false);
                  setReopenStoreError(null);
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={reopeningStore || reopenStoreReason.trim().length < 5}
                onClick={handleConfirmReopenStore}
              >
                {reopeningStore ? "Reabrindo..." : "Confirmar Reabertura da Loja"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {/* MODAL: SELEÇÃO DA LOJA (ENTRADA OU TROCA DE LOJA) */}
      {showStoreSelectModal ? (
        <div className="alloc-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="store-select-modal-title">
          <div className="alloc-modal" style={{ maxWidth: "680px" }}>
            <header className="alloc-modal__header">
              <div>
                <h2 id="store-select-modal-title">🏪 Selecione a Loja para Destinação</h2>
                <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#64748b" }}>
                  Ciclo {cycleDate} • Escolha a loja para conferir e destinar as compras
                </p>
              </div>
              {activeStore ? (
                <button
                  type="button"
                  className="btn btn--secondary"
                  style={{ minHeight: "32px", padding: "4px 8px" }}
                  onClick={() => setShowStoreSelectModal(false)}
                  aria-label="Fechar"
                >
                  ✕
                </button>
              ) : null}
            </header>
            <div className="alloc-modal__body">
              <div className="alloc-store-picker-grid">
                {stores.map((store) => {
                  const summary = storeSummary[store.id];
                  const cleanName = store.name.replace("MultiShow ", "");
                  const isStoreClosed = summary?.closureStatus === "CLOSED";
                  const isStoreStale = summary?.isStale;
                  const isCurrentActive = store.id === activeStoreId;

                  return (
                    <button
                      key={store.id}
                      type="button"
                      className={`alloc-store-picker-card ${isCurrentActive ? "alloc-store-picker-card--active" : ""}`}
                      onClick={() => {
                        setShowStoreSelectModal(false);
                        handleSelectStore(store.id, true);
                      }}
                    >
                      <div className="alloc-store-picker-card__header">
                        <span className="alloc-store-picker-card__icon">🏪</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <h3 className="alloc-store-picker-card__name">{cleanName}</h3>
                          <span className="alloc-store-picker-card__sub">MultiShow</span>
                        </div>
                        {isStoreClosed && !isStoreStale ? (
                          <span className="alloc-status-pill alloc-status-pill--closed">
                            ✓ Finalizada
                          </span>
                        ) : isStoreClosed && isStoreStale ? (
                          <span className="alloc-status-pill alloc-status-pill--stale" title={summary?.staleReason ?? "Reconferir"}>
                            ⚠️ Reconferir
                          </span>
                        ) : (
                          <span className="alloc-status-pill alloc-status-pill--open">
                            ⏳ Aberta
                          </span>
                        )}
                      </div>

                      <div className="alloc-store-picker-card__metrics">
                        <div className="alloc-store-picker-card__metric">
                          <span className="label">Itens Pedidos:</span>
                          <span className="val">{summary?.totalOrderedProducts ?? 0}</span>
                        </div>
                        <div className="alloc-store-picker-card__metric">
                          <span className="label">Total Destinado:</span>
                          <span className="val">{summary ? `${summary.totalDestinedQuantity} CX` : "0.00 CX"}</span>
                        </div>
                        <div className="alloc-store-picker-card__metric">
                          <span className="label">Pendências:</span>
                          <span
                            className="val"
                            style={{
                              color: summary?.totalPendingProducts ? "#c2410c" : "#15803d",
                              fontWeight: "700",
                            }}
                          >
                            {summary?.totalPendingProducts ?? 0}
                          </span>
                        </div>
                      </div>

                      <div className="alloc-store-picker-card__footer">
                        <span className="alloc-store-picker-card__action">
                          {isCurrentActive ? "Loja Selecionada ✓" : "Conferir esta Loja →"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            {activeStore ? (
              <footer className="alloc-modal__footer" style={{ justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => setShowStoreSelectModal(false)}
                >
                  Continuar em {activeStore.name.replace("MultiShow ", "")}
                </button>
              </footer>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* MODAL: REGISTRAR NOTA FISCAL (FASE 4) */}
      {showRegisterInvoiceModal ? (
        <div className="alloc-modal-backdrop" role="dialog" aria-modal="true">
          <div className="alloc-modal" style={{ maxWidth: "480px" }}>
            <header className="alloc-modal__header">
              <h3>📄 Registrar Nota Fiscal</h3>
              <button
                type="button"
                className="alloc-modal__close"
                onClick={() => {
                  setShowRegisterInvoiceModal(false);
                  handleRemoveInvoiceFile();
                }}
                aria-label="Fechar"
              >
                ✕
              </button>
            </header>

            <form onSubmit={handleSaveInvoice}>
              <div className="alloc-modal__body" style={{ padding: "16px 20px" }}>
                <div style={{ backgroundColor: "#f8fafc", padding: "10px 12px", borderRadius: "6px", marginBottom: "14px", fontSize: "13px" }}>
                  <div><strong>Loja:</strong> {activeStore.name}</div>
                  <div><strong>Fornecedor:</strong> {selectedSupplier?.corporateName}</div>
                  <div><strong>Ciclo:</strong> {cycleDate}</div>
                </div>

                {registerInvoiceError ? (
                  <div className="alloc-banner alloc-banner--closed" style={{ backgroundColor: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", marginBottom: "12px", fontSize: "13px", padding: "8px 12px" }}>
                    ⚠️ {registerInvoiceError}
                  </div>
                ) : null}

                <div style={{ marginBottom: "14px" }}>
                  <label htmlFor="invoice-number-input" style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
                    Número da Nota Fiscal <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <input
                    id="invoice-number-input"
                    type="text"
                    required
                    value={invoiceNumberInput}
                    onChange={(e) => setInvoiceNumberInput(e.target.value)}
                    placeholder="Ex: 12345"
                    className="alloc-qty-input"
                    style={{ width: "100%", padding: "8px 12px", fontSize: "14px", borderRadius: "6px", border: "1px solid #cbd5e1", boxSizing: "border-box" }}
                  />
                </div>

                {/* VINCULAÇÃO EXPLÍCITA AOS PRODUTOS DESTINADOS (FASE 4) */}
                <div style={{ marginBottom: "14px" }}>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
                    Produtos Destinados Abrangidos por esta Nota <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  {destinedProductsForSupplierAndStore.length === 0 ? (
                    <div style={{ padding: "8px 12px", backgroundColor: "#fffbeb", border: "1px solid #fde68a", borderRadius: "6px", color: "#92400e", fontSize: "12px" }}>
                      ⚠️ Não há produtos com destinação positiva para este fornecedor nesta loja. Destine ao menos um produto antes de cadastrar a nota fiscal.
                    </div>
                  ) : (
                    <div style={{ maxHeight: "140px", overflowY: "auto", border: "1px solid #cbd5e1", borderRadius: "6px", padding: "6px 8px", backgroundColor: "#ffffff" }}>
                      {destinedProductsForSupplierAndStore.map((p) => {
                        const isChecked = selectedInvoiceProductIds.includes(p.productId);
                        const storeData = p.stores[activeStoreId];
                        return (
                          <label
                            key={p.productId}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              padding: "4px 6px",
                              fontSize: "13px",
                              cursor: "pointer",
                              borderRadius: "4px",
                              backgroundColor: isChecked ? "#f0fdf4" : "transparent",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedInvoiceProductIds((prev) => [...prev, p.productId]);
                                } else {
                                  setSelectedInvoiceProductIds((prev) => prev.filter((id) => id !== p.productId));
                                }
                              }}
                            />
                            <span>
                              <strong>[{p.erpCode}] {p.productName}</strong> — {storeData.destinedQuantity} {p.purchaseFormat}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div style={{ marginBottom: "14px" }}>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
                    Fotografia da Nota <span style={{ color: "#dc2626" }}>*</span>
                  </label>

                  {!invoiceFile ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                      {/* Opção 1: Câmera direta do celular */}
                      <label
                        htmlFor="invoice-file-camera"
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: "16px 8px",
                          border: "2px dashed #0284c7",
                          borderRadius: "8px",
                          cursor: "pointer",
                          backgroundColor: "#f0f9ff",
                          textAlign: "center",
                        }}
                      >
                        <span style={{ fontSize: "28px", marginBottom: "4px" }}>📸</span>
                        <strong style={{ fontSize: "13px", color: "#0369a1" }}>Tirar Foto (Câmera)</strong>
                        <span style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>Abre a câmera do celular</span>
                      </label>
                      <input
                        id="invoice-file-camera"
                        type="file"
                        accept="image/*"
                        capture="environment"
                        style={{ display: "none" }}
                        onChange={handleInvoiceFileChange}
                      />

                      {/* Opção 2: Escolher da galeria / arquivos */}
                      <label
                        htmlFor="invoice-file-gallery"
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: "16px 8px",
                          border: "2px dashed #cbd5e1",
                          borderRadius: "8px",
                          cursor: "pointer",
                          backgroundColor: "#f8fafc",
                          textAlign: "center",
                        }}
                      >
                        <span style={{ fontSize: "28px", marginBottom: "4px" }}>📁</span>
                        <strong style={{ fontSize: "13px", color: "#334155" }}>Galeria / Arquivo</strong>
                        <span style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>Seleciona imagem existente</span>
                      </label>
                      <input
                        id="invoice-file-gallery"
                        type="file"
                        accept="image/*"
                        style={{ display: "none" }}
                        onChange={handleInvoiceFileChange}
                      />
                    </div>
                  ) : (
                    <div style={{ border: "1px solid #e2e8f0", borderRadius: "8px", padding: "10px", backgroundColor: "#f8fafc" }}>
                      {invoicePreviewUrl ? (
                        <div style={{ textAlign: "center", marginBottom: "8px" }}>
                          <img
                            src={invoicePreviewUrl}
                            alt="Prévia da Nota Fiscal"
                            style={{ maxHeight: "200px", maxWidth: "100%", objectFit: "contain", borderRadius: "4px" }}
                          />
                        </div>
                      ) : null}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: "12px", color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "200px" }}>
                          {invoiceFile.name} ({(invoiceFile.size / 1024).toFixed(0)} KB)
                        </span>
                        <div style={{ display: "flex", gap: "6px" }}>
                          <label
                            htmlFor="invoice-file-replace"
                            className="btn btn--secondary btn--sm"
                            style={{ cursor: "pointer", fontSize: "12px", padding: "4px 8px" }}
                          >
                            Trocar Foto
                          </label>
                          <input
                            id="invoice-file-replace"
                            type="file"
                            accept="image/*"
                            style={{ display: "none" }}
                            onChange={handleInvoiceFileChange}
                          />
                          <button
                            type="button"
                            className="btn btn--danger btn--sm"
                            style={{ fontSize: "12px", padding: "4px 8px" }}
                            onClick={handleRemoveInvoiceFile}
                          >
                            Remover
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ marginBottom: "10px" }}>
                  <label htmlFor="invoice-notes-input" style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
                    Observações (opcional)
                  </label>
                  <textarea
                    id="invoice-notes-input"
                    value={invoiceNotesInput}
                    onChange={(e) => setInvoiceNotesInput(e.target.value)}
                    placeholder="Ex: Primeira remessa da manhã"
                    rows={2}
                    style={{ width: "100%", padding: "8px 12px", fontSize: "13px", borderRadius: "6px", border: "1px solid #cbd5e1", boxSizing: "border-box" }}
                  />
                </div>
              </div>

              <footer className="alloc-modal__footer" style={{ display: "flex", justifyContent: "flex-end", gap: "8px", padding: "12px 20px" }}>
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={registeringInvoice}
                  onClick={() => {
                    setShowRegisterInvoiceModal(false);
                    handleRemoveInvoiceFile();
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={
                    registeringInvoice ||
                    !invoiceNumberInput.trim() ||
                    !invoiceFile ||
                    destinedProductsForSupplierAndStore.length === 0 ||
                    selectedInvoiceProductIds.length === 0
                  }
                >
                  {registeringInvoice ? "Salvando Nota..." : "Salvar Nota Fiscal"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      ) : null}

      {/* MODAL: VISUALIZAR NOTAS FISCAIS DA COMBINAÇÃO (FASE 4) */}
      {showViewInvoicesModal ? (
        <div className="alloc-modal-backdrop" role="dialog" aria-modal="true">
          <div className="alloc-modal" style={{ maxWidth: "560px" }}>
            <header className="alloc-modal__header">
              <h3>📄 Notas Fiscais Registradas</h3>
              <button
                type="button"
                className="alloc-modal__close"
                onClick={() => setShowViewInvoicesModal(false)}
                aria-label="Fechar"
              >
                ✕
              </button>
            </header>

            <div className="alloc-modal__body" style={{ padding: "16px 20px" }}>
              <div style={{ backgroundColor: "#f8fafc", padding: "10px 12px", borderRadius: "6px", marginBottom: "14px", fontSize: "13px" }}>
                <div><strong>Loja:</strong> {activeStore.name}</div>
                <div><strong>Fornecedor:</strong> {selectedSupplier?.corporateName}</div>
                <div><strong>Ciclo:</strong> {cycleDate}</div>
              </div>

              {currentSupplierInvoices.length === 0 ? (
                <p style={{ textAlign: "center", color: "#64748b", padding: "20px" }}>
                  Nenhuma nota fiscal registrada para este fornecedor nesta loja.
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {currentSupplierInvoices.map((inv) => (
                    <div
                      key={inv.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "12px",
                        border: "1px solid #e2e8f0",
                        borderRadius: "8px",
                        backgroundColor: "#ffffff",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <div
                          style={{
                            width: "56px",
                            height: "56px",
                            borderRadius: "6px",
                            overflow: "hidden",
                            backgroundColor: "#f1f5f9",
                            cursor: "pointer",
                            flexShrink: 0,
                            border: "1px solid #cbd5e1",
                          }}
                          onClick={() => setViewingPhotoUrl(`/api/invoices/${inv.id}/image`)}
                          title="Clique para ver a foto ampliada"
                        >
                          <img
                            src={`/api/invoices/${inv.id}/image`}
                            alt={`NF ${inv.invoiceNumber}`}
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          />
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: "15px", color: "#0f172a" }}>
                            NF {inv.invoiceNumber}
                          </div>
                          <div style={{ fontSize: "12px", color: "#64748b" }}>
                            {(inv.fileSizeBytes / 1024).toFixed(0)} KB • Registrada em {new Date(inv.createdAt).toLocaleString("pt-BR")}
                          </div>
                          {inv.notes ? (
                            <div style={{ fontSize: "12px", color: "#334155", marginTop: "2px" }}>
                              <em>{inv.notes}</em>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          style={{ fontSize: "12px" }}
                          onClick={() => setViewingPhotoUrl(`/api/invoices/${inv.id}/image`)}
                        >
                          Ver Foto
                        </button>
                        {!isClosed ? (
                          <button
                            type="button"
                            className="btn btn--danger btn--sm"
                            style={{ fontSize: "12px" }}
                            disabled={deletingInvoiceId === inv.id}
                            onClick={() => handleDeleteInvoice(inv.id)}
                          >
                            {deletingInvoiceId === inv.id ? "Excluindo..." : "Excluir"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <footer className="alloc-modal__footer" style={{ display: "flex", justifyContent: "space-between", padding: "12px 20px" }}>
              {!isClosed ? (
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => {
                    setShowViewInvoicesModal(false);
                    handleOpenRegisterInvoice();
                  }}
                >
                  + Adicionar Outra Nota
                </button>
              ) : <div />}
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => setShowViewInvoicesModal(false)}
              >
                Fechar
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {/* LIGHTBOX: FOTO AMPLIADA DA NOTA FISCAL */}
      {viewingPhotoUrl ? (
        <div
          className="alloc-modal-backdrop"
          style={{ zIndex: 1100, backgroundColor: "rgba(0, 0, 0, 0.85)" }}
          onClick={() => setViewingPhotoUrl(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            style={{
              position: "relative",
              maxWidth: "92vw",
              maxHeight: "92vh",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              style={{
                position: "absolute",
                top: "-36px",
                right: "0",
                background: "white",
                border: "none",
                borderRadius: "50%",
                width: "32px",
                height: "32px",
                fontSize: "16px",
                fontWeight: "bold",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              onClick={() => setViewingPhotoUrl(null)}
              aria-label="Fechar Foto"
            >
              ✕
            </button>
            <img
              src={viewingPhotoUrl}
              alt="Fotografia da Nota Fiscal"
              style={{
                maxWidth: "100%",
                maxHeight: "85vh",
                objectFit: "contain",
                borderRadius: "8px",
                boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5)",
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
