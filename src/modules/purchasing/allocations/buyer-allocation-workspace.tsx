"use client";

import Link from "next/link";
import Image from "next/image";
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
import {
  suggestionLabel,
  closureItemTag,
  filterSuppliers,
  formatQty,
  isProductPending,
  productStoreStatus,
  sortSuppliersForPicker,
  splitClosureItems,
  storeProgress,
  supplierInitials,
} from "./destination-view";
import { shortStoreName, storeColor } from "@/modules/purchasing/domain";
import { compressImageForUpload } from "@/lib/compress-image";
import "./styles.css";
import "./destination-mobile.css";

function SvgIcon({ children, size = 20 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}
const IconChevronLeft = () => <SvgIcon size={22}><path d="M15 18l-6-6 6-6" /></SvgIcon>;
const IconChevronRight = () => <SvgIcon size={18}><path d="M9 6l6 6-6 6" /></SvgIcon>;
const IconSearch = () => <SvgIcon size={18}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></SvgIcon>;
const IconCheck = () => <SvgIcon size={18}><path d="M5 12l5 5L20 7" /></SvgIcon>;
const IconClose = () => <SvgIcon><path d="M6 6l12 12M18 6L6 18" /></SvgIcon>;
const IconCalendar = () => <SvgIcon size={16}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></SvgIcon>;
const IconAlert = () => (
  <SvgIcon>
    <path d="M12 9v4M12 17h.01" />
    <path d="M10.3 3.9L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
  </SvgIcon>
);

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
  showClosedCycles = false,
}: {
  data: BuyerAllocationWorkspaceData;
  hasExplicitStoreSelection?: boolean;
  /** Seletor de ciclos inclui os fechados (pelo comprador ou encerrados pelo Gestor). */
  showClosedCycles?: boolean;
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
    unassignedOpportunityProducts = [],
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
  // Loja à qual se refere o aviso "itens sem fornecedor" (calculado por loja no servidor).
  const unassignedStoreLabel = activeStore.id === "unknown" ? "" : activeStore.name.replace("MultiShow ", "");

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
  // Apresentação mobile: filtro (null = automático), busca, seletor de fornecedor
  const [listFilter, setListFilter] = useState<"pending" | "all" | null>(null);
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [showSupplierPicker, setShowSupplierPicker] = useState(false);
  const [supplierQuery, setSupplierQuery] = useState("");
  const [expandedProductIds, setExpandedProductIds] = useState<Set<string>>(() => new Set());
  const [showFulfilledCuts, setShowFulfilledCuts] = useState(false);
  // Confirmação explícita: comprados que não foram para a loja são corte.
  const [confirmZeroCuts, setConfirmZeroCuts] = useState(false);
  // Texto digitado no campo de quantidade enquanto ele está em foco (fora do foco mostra "5" em vez de "5.00").
  const [qtyDraft, setQtyDraft] = useState<{ productId: string; text: string } | null>(null);

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

  // Conjunto de IDs de produtos cobertos por ao menos uma nota fiscal para o fornecedor e loja selecionados
  const coveredProductIds = useMemo(() => {
    const ids = new Set<string>();
    for (const inv of currentSupplierInvoices) {
      for (const pid of inv.itemProductIds || []) {
        ids.add(pid);
      }
    }
    return ids;
  }, [currentSupplierInvoices]);

  // Produtos destinados que ainda não foram vinculados a nenhuma nota fiscal
  const unlinkedDestinedProducts = useMemo(() => {
    return destinedProductsForSupplierAndStore.filter((p) => !coveredProductIds.has(p.productId));
  }, [destinedProductsForSupplierAndStore, coveredProductIds]);

  // Formulário de registro de nota fiscal
  const [invoiceNumberInput, setInvoiceNumberInput] = useState("");
  const [invoiceNotesInput, setInvoiceNotesInput] = useState("");
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [invoicePreviewUrl, setInvoicePreviewUrl] = useState<string | null>(null);
  const [selectedInvoiceProductIds, setSelectedInvoiceProductIds] = useState<string[]>([]);
  const [registeringInvoice, setRegisteringInvoice] = useState(false);
  const [registerInvoiceError, setRegisterInvoiceError] = useState<string | null>(null);
  const [preparingInvoicePhoto, setPreparingInvoicePhoto] = useState(false);

  // Exclusão de nota fiscal
  const [deletingInvoiceId, setDeletingInvoiceId] = useState<string | null>(null);

  const handleOpenRegisterInvoice = () => {
    setInvoiceNumberInput("");
    setInvoiceNotesInput("");
    setInvoiceFile(null);
    if (invoicePreviewUrl) URL.revokeObjectURL(invoicePreviewUrl);
    setInvoicePreviewUrl(null);
    setRegisterInvoiceError(null);
    // Prioriza pré-seleção dos produtos ainda pendentes de nota fiscal
    const initialSelected =
      unlinkedDestinedProducts.length > 0
        ? unlinkedDestinedProducts.map((p) => p.productId)
        : destinedProductsForSupplierAndStore.map((p) => p.productId);
    setSelectedInvoiceProductIds(initialSelected);
    setShowRegisterInvoiceModal(true);
  };

  const handleInvoiceFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const original = e.target.files?.[0];
    if (!original) return;
    setRegisterInvoiceError(null);
    // Reduz a foto no celular antes do envio (era o que deixava salvar lento).
    setPreparingInvoicePhoto(true);
    const file = await compressImageForUpload(original);
    setPreparingInvoicePhoto(false);
    if (file.size > 10 * 1024 * 1024) {
      setRegisterInvoiceError("O tamanho da imagem excede o limite permitido de 10 MB.");
      return;
    }
    if (invoicePreviewUrl) URL.revokeObjectURL(invoicePreviewUrl);
    setInvoiceFile(file);
    setInvoicePreviewUrl(URL.createObjectURL(file));
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
      `/comprador/destinacao?ciclo=${nextContext.cycleDate}&loja=${nextContext.storeId}&fornecedor=${nextContext.supplierId}${showClosedCycles ? "&fechados=1" : ""}`,
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

    handleQuantityChange(productId, storeAlloc.suggestedQuantity ?? storeAlloc.orderedQuantity);
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

      // Começa em zero: o comprador informa a quantidade (ou usa o atalho).
      const destinedQty = "0.00";
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
        suggestedQuantity: item.purchasedInCosts === false ? "0.00" : roundToTwoDecimals(orderNum),
        destinedInOtherSuppliers: "0.00",
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
  // O botão "Não comprei deste fornecedor" saiu (04/11/2026): zero = não comprou.
  // A confirmação abaixo continua para decisões antigas exibidas na tela.
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
    setConfirmZeroCuts(false);
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
        confirmPurchasedZeroCuts: confirmZeroCuts,
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


  // ---------------------------------------------------------------------------
  // Apresentação mobile-first (redesenho da Destinação). Somente leitura dos
  // dados já calculados acima; nenhuma regra de gravação muda aqui.
  // ---------------------------------------------------------------------------
  const shortActiveStoreName = activeStore.name.replace("MultiShow ", "");
  const cycleLabel = new Date(cycleDate + "T12:00:00").toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });

  const productViews = products.map((prod) => {
    const storeData: StoreAllocationData = prod.stores[activeStoreId] ?? {
      storeId: activeStoreId,
      storeName: activeStore.name,
      storeSlug: activeStore.slug,
      orderedQuantity: "0.00",
      destinedQuantity: "0.00",
      persistedDestinedQuantity: null,
      difference: "0.00",
      isAdditionalPurchase: false,
    };
    const hasOrder = parseQuantity(storeData.orderedQuantity) > 0;
    const isUnpurchasedWithOrders = !prod.purchasedInCosts && parseQuantity(prod.totalOrdered) > 0;
    const hasDestinedInActiveStore = parseQuantity(storeData.destinedQuantity) > 0;
    const notPurchased = prod.supplierDecision === "NOT_PURCHASED";
    const status = productStoreStatus({
      store: storeData,
      unit: prod.purchaseFormat,
      blockedByCosts: isUnpurchasedWithOrders,
      destinedInOtherSuppliers: storeData.destinedInOtherSuppliers,
    });
    const pending = isProductPending({
      store: storeData,
      destinedInOtherSuppliers: storeData.destinedInOtherSuppliers,
      blockedByCosts: isUnpurchasedWithOrders,
      hasDestinedInStore: hasDestinedInActiveStore,
    });
    const hasUnsavedChange = hasPendingStoreAllocation(storeData);
    // Item resolvido e salvo: vira uma linha compacta (toque em "Editar" para abrir).
    const isSettled =
      !hasUnsavedChange &&
      !isUnpurchasedWithOrders &&
      ((status.kind === "integral" && storeData.persistedDestinedQuantity !== null) || status.kind === "elsewhere");
    return {
      prod,
      storeData,
      hasOrder,
      isUnpurchasedWithOrders,
      hasDestinedInActiveStore,
      notPurchased,
      status,
      pending,
      hasUnsavedChange,
      isSettled,
    };
  });
  const pendingViewCount = productViews.filter((view) => view.pending).length;
  const effectiveListFilter = listFilter ?? (pendingViewCount > 0 ? "pending" : "all");
  const visibleProductIds = new Set(filteredProducts.map((p) => p.productId));
  const visibleProductViews = productViews.filter(
    (view) =>
      visibleProductIds.has(view.prod.productId) &&
      (effectiveListFilter === "all" || view.pending || view.hasUnsavedChange),
  );
  const orderedProductCount = productViews.filter((view) => view.hasOrder).length;
  const decidedProductCount = Math.max(0, orderedProductCount - pendingViewCount);

  const supplierPosition = selectedSupplierId ? currentSupplierIndex + 1 : 0;
  const pickerSuppliers = filterSuppliers(
    sortSuppliersForPicker(suppliers, selectedSupplierId, activeStoreId),
    supplierQuery,
  );
  const reviewedSupplierCount = suppliers.filter((s) => s.reviewedByStore?.[activeStoreId]).length;

  const nfStatus: { tone: "integral" | "partial"; label: string } | null =
    destinedProductsForSupplierAndStore.length === 0
      ? null
      : unlinkedDestinedProducts.length === 0
        ? { tone: "integral", label: "Notas OK" }
        : currentSupplierInvoices.length > 0
          ? { tone: "partial", label: `${unlinkedDestinedProducts.length} sem nota` }
          : { tone: "partial", label: "Sem nota" };

  const toggleExpanded = (productId: string) =>
    setExpandedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  const closureGapsBlocking = targetStoreClosure?.purchasedWithoutDestination ?? [];
  const closureGapsToConfirm = targetStoreClosure?.purchasedZeroForStore ?? [];
  // Itens já mostrados nos quadros de trava/confirmação não se repetem na lista de cortes.
  const closureGapIds = new Set([...closureGapsToConfirm, ...closureGapsBlocking].map((g) => g.productId));
  const closureItems = splitClosureItems(
    (targetStoreClosure?.cuts ?? []).filter((cut) => !closureGapIds.has(cut.productId)),
  );
  const closureBlocked =
    closureGapsBlocking.length > 0 || (closureGapsToConfirm.length > 0 && !confirmZeroCuts);

  return (
    <div className="alloc-workspace dst">
      {showStoreSelectModal ? (
        /* TELA 1: ESCOLHER LOJA (entrada da Destinação ou troca de loja) */
        <section className="dst-screen" aria-labelledby="store-select-modal-title">
          <header className="dst-head">
            <div className="dst-head__row dst-head__row--end">
              <div className="dst-head__titles">
                <h1 id="store-select-modal-title" className="dst-title dst-title--xl">Destinação</h1>
                <span className="dst-subtle">Escolha a loja para começar</span>
              </div>
              <label className="dst-cycle-select">
                <IconCalendar />
                <span className="visually-hidden">Ciclo de compras</span>
                <select
                  id="cycle-picker"
                  value={cycleDate}
                  onChange={(e) => handleSelectCycle(e.target.value)}
                >
                  {cycles.map((c) => (
                    <option key={c} value={c}>
                      {new Date(c + "T12:00:00").toLocaleDateString("pt-BR")}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <Link
              href={`/comprador/destinacao?ciclo=${cycleDate}${showClosedCycles ? "" : "&fechados=1"}`}
              className="dst-link dst-link--small"
            >
              {showClosedCycles ? "Ocultar ciclos fechados" : "Ver ciclos fechados"}
            </Link>
          </header>

          <div className="dst-body">
            <div className="dst-kpis">
              <div className="dst-kpi">
                <span>Comprados</span>
                <strong>{closure.totalPurchasedInCosts}</strong>
              </div>
              <div className="dst-kpi">
                <span>Destinados</span>
                <strong>{closure.totalAllocatedProducts}</strong>
              </div>
              <div className={`dst-kpi ${unclosedStores.length > 0 ? "dst-kpi--warn" : "dst-kpi--ok"}`}>
                <span>Lojas abertas</span>
                <strong>{unclosedStores.length}</strong>
              </div>
            </div>

            {isClosed ? (
              <div className="dst-callout dst-callout--info" role="status">
                <div>
                  <strong>Ciclo fechado</strong>
                  <span>
                    Por {closure.closedByName ?? "Comprador"} em{" "}
                    {closure.closedAt ? new Date(closure.closedAt).toLocaleString("pt-BR") : "—"}. Somente leitura.
                  </span>
                </div>
              </div>
            ) : null}

            <h2 className="dst-section-title">Lojas do ciclo</h2>

            <div className="dst-store-list">
              {stores.map((store) => {
                const progress = storeProgress(storeSummary[store.id]);
                const isCurrentActive = store.id === activeStoreId && hasExplicitStoreSelection;
                const closureInfo = storeClosures[store.id];
                return (
                  <button
                    key={store.id}
                    type="button"
                    className={`dst-store-card store-${storeColor(store.slug)}${isCurrentActive ? " dst-store-card--active" : ""}`}
                    onClick={() => {
                      setShowStoreSelectModal(false);
                      handleSelectStore(store.id, true);
                    }}
                  >
                    <span className="dst-store-card__top">
                      <strong className="dst-store-card__name">{shortStoreName(store.name)}</strong>
                      <span className={`status-tag status-tag--${progress.tone}`}>{progress.label}</span>
                    </span>
                    <span className="dst-progress" aria-hidden="true">
                      <span
                        className={`dst-progress__bar${progress.state === "finalized" ? " dst-progress__bar--done" : ""}`}
                        style={{ width: `${progress.percent}%` }}
                      />
                    </span>
                    <span className="dst-store-card__meta">
                      {progress.state === "finalized" ? (
                        <span>
                          <strong>{progress.done} de {progress.total}</strong> itens
                          {closureInfo?.closedAt
                            ? ` · finalizada às ${new Date(closureInfo.closedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
                            : ""}
                          {closureInfo?.closedByName ? ` por ${closureInfo.closedByName}` : ""}
                        </span>
                      ) : (
                        <>
                          <span>
                            <strong>{progress.done} de {progress.total}</strong> itens atendidos
                          </span>
                          {progress.pending > 0 ? (
                            <span className="dst-text-danger">{progress.pending} pendentes</span>
                          ) : null}
                        </>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            {hasExplicitStoreSelection && (unassignedPurchasedProducts.length > 0 || unassignedOpportunityProducts.length > 0) ? (
              <button
                type="button"
                className="dst-callout dst-callout--danger dst-callout--button"
                onClick={() => setShowUnassignedModal(true)}
              >
                <IconAlert />
                <span>
                  {unassignedPurchasedProducts.length} comprados sem fornecedor
                  {unassignedStoreLabel ? ` — ${unassignedStoreLabel}` : ""}
                  {unassignedOpportunityProducts.length > 0 ? ` (+${unassignedOpportunityProducts.length} sem pedido)` : ""}
                </span>
              </button>
            ) : null}

            <div className="dst-cycle-actions">
              {isClosed ? (
                <button type="button" className="btn btn--secondary" onClick={() => setShowReopenModal(true)}>
                  Reabrir ciclo
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
                  Fechar ciclo geral ({stores.length - unclosedStores.length}/{stores.length} lojas finalizadas)
                </button>
              )}
              {hasExplicitStoreSelection ? (
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => setShowStoreSelectModal(false)}
                >
                  Continuar em {shortActiveStoreName}
                </button>
              ) : null}
            </div>
          </div>
        </section>
      ) : (
        /* TELA 2: PRODUTOS DO FORNECEDOR NA LOJA ATIVA */
        <section className="dst-screen" aria-label={`Destinação de ${shortActiveStoreName}`}>
          <header className="dst-head dst-head--sticky">
            <div className="dst-head__row">
              <button
                type="button"
                className="dst-icon-btn"
                aria-label="Trocar loja"
                title="Voltar para a lista de lojas"
                onClick={() => setShowStoreSelectModal(true)}
              >
                <IconChevronLeft />
              </button>
              <div className="dst-head__titles">
                <span className="dst-eyebrow">Compra {cycleLabel}</span>
                <h1 className={`dst-title dst-store-name store-${storeColor(activeStore.slug)}`}>
                  {shortActiveStoreName}
                </h1>
              </div>
              {activeStoreSummary?.closureStatus === "CLOSED" && !activeStoreSummary.isStale ? (
                <span className="status-tag status-tag--integral">Finalizada</span>
              ) : activeStoreSummary?.closureStatus === "CLOSED" && activeStoreSummary.isStale ? (
                <span className="status-tag status-tag--partial" title={activeStoreSummary.staleReason ?? "Reconferir"}>
                  Reconferir
                </span>
              ) : (activeStoreSummary?.totalPendingProducts ?? 0) > 0 ? (
                <span className="dst-head__pending">{activeStoreSummary?.totalPendingProducts} pendentes</span>
              ) : null}
            </div>

            <button
              type="button"
              className="dst-supplier-btn"
              onClick={() => {
                setSupplierQuery("");
                setShowSupplierPicker(true);
              }}
              aria-haspopup="dialog"
            >
              {selectedSupplier ? (
                <>
                  <span
                    className={`dst-avatar ${selectedSupplier.reviewedByStore?.[activeStoreId] ? "dst-avatar--done" : "dst-avatar--current"}`}
                    aria-hidden="true"
                  >
                    {selectedSupplier.reviewedByStore?.[activeStoreId] ? <IconCheck /> : supplierInitials(selectedSupplier.displayName)}
                  </span>
                  <span className="dst-supplier-btn__text">
                    <strong>{selectedSupplier.displayName}</strong>
                    <span>
                      Fornecedor {supplierPosition} de {suppliers.length}
                      {orderedProductCount > 0 ? ` · ${decidedProductCount} de ${orderedProductCount} itens decididos` : ""}
                      {selectedSupplier.reviewedByStore?.[activeStoreId] ? " · conferido" : ""}
                    </span>
                  </span>
                  <span className="dst-supplier-btn__action">Trocar</span>
                </>
              ) : (
                <>
                  <span className="dst-avatar" aria-hidden="true">?</span>
                  <span className="dst-supplier-btn__text">
                    <strong>Escolher fornecedor</strong>
                    <span>{suppliers.length} fornecedores no ciclo</span>
                  </span>
                  <span className="dst-supplier-btn__action">Abrir</span>
                </>
              )}
            </button>

            {selectedSupplierId ? (
              <div className="dst-filter-row">
                <button
                  type="button"
                  className={`dst-chip${effectiveListFilter === "pending" ? " dst-chip--active" : ""}`}
                  aria-pressed={effectiveListFilter === "pending"}
                  onClick={() => setListFilter("pending")}
                >
                  Pendentes {pendingViewCount}
                </button>
                <button
                  type="button"
                  className={`dst-chip${effectiveListFilter === "all" ? " dst-chip--active" : ""}`}
                  aria-pressed={effectiveListFilter === "all"}
                  onClick={() => setListFilter("all")}
                >
                  Todos {products.length}
                </button>
                <button
                  type="button"
                  className={`dst-chip dst-chip--icon${showProductSearch || searchQuery ? " dst-chip--active" : ""}`}
                  aria-label="Buscar produto"
                  aria-expanded={showProductSearch}
                  onClick={() => setShowProductSearch((open) => !open)}
                >
                  <IconSearch />
                </button>
              </div>
            ) : null}

            {selectedSupplierId && (showProductSearch || searchQuery) ? (
              <label className="dst-search">
                <IconSearch />
                <input
                  type="search"
                  placeholder={`Buscar produto para ${shortActiveStoreName}`}
                  aria-label="Buscar produto"
                  value={searchQuery}
                  autoFocus
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </label>
            ) : null}
          </header>

          <div className="dst-body">
            {isClosed ? (
              <div className="dst-callout dst-callout--info" role="status">
                <div>
                  <strong>Ciclo fechado — somente leitura</strong>
                  <span>
                    Por {closure.closedByName ?? "Comprador"} em{" "}
                    {closure.closedAt ? new Date(closure.closedAt).toLocaleString("pt-BR") : "—"}.
                  </span>
                </div>
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => setShowReopenModal(true)}>
                  Reabrir
                </button>
              </div>
            ) : null}

            {unassignedPurchasedProducts.length > 0 || unassignedOpportunityProducts.length > 0 ? (
              <button
                type="button"
                className="dst-callout dst-callout--danger dst-callout--button"
                onClick={() => setShowUnassignedModal(true)}
              >
                <IconAlert />
                <span>
                  {unassignedPurchasedProducts.length} comprados sem fornecedor
                  {unassignedStoreLabel ? ` em ${unassignedStoreLabel}` : ""}
                  {unassignedOpportunityProducts.length > 0 ? ` (+${unassignedOpportunityProducts.length} sem pedido)` : ""}
                </span>
              </button>
            ) : null}

            {/* MENSAGENS DE FEEDBACK */}
            {saveMessage ? (
              <div className="alloc-banner alloc-banner--closed dst-feedback" role="status">
                <span>✓ {saveMessage}</span>
              </div>
            ) : null}
            {errorMessage ? (
              <div className="alloc-banner alloc-banner--warning dst-feedback" role="alert">
                <span>⚠️ {errorMessage}</span>
              </div>
            ) : null}

            {selectedSupplier ? (
              <details className="dst-details">
                <summary>
                  <span>Notas fiscais e detalhes</span>
                  {nfStatus ? (
                    <span className={`status-tag status-tag--${nfStatus.tone}`}>{nfStatus.label}</span>
                  ) : null}
                </summary>
                <div className="dst-details__body">
                  {selectedSupplier.displayName !== selectedSupplier.corporateName ? (
                    <p className="dst-subtle">{selectedSupplier.corporateName}</p>
                  ) : null}
                  {selectedSupplier.taxId ? (
                    <p className="dst-subtle">CNPJ {formatTaxId(selectedSupplier.taxId)}</p>
                  ) : null}
                  {activeSupplierReview ? (
                    <p className="dst-text-ok">✓ Conferência concluída para {shortActiveStoreName}</p>
                  ) : null}
                  <dl className="dst-facts">
                    <div>
                      <dt>Destinado em {shortActiveStoreName}</dt>
                      <dd>{formatQty(activeStoreTotalDestined)} CX</dd>
                    </div>
                    <div>
                      <dt>Total do ciclo (todas as lojas)</dt>
                      <dd>{formatQty(selectedSupplier.totalDestinedQuantity)} CX</dd>
                    </div>
                  </dl>
                  {destinedProductsForSupplierAndStore.length > 0 ? (
                    <p className={unlinkedDestinedProducts.length > 0 ? "dst-text-warn" : "dst-text-ok"}>
                      {unlinkedDestinedProducts.length > 0
                        ? currentSupplierInvoices.length > 0
                          ? `${unlinkedDestinedProducts.length} de ${destinedProductsForSupplierAndStore.length} item(ns) sem nota`
                          : "Destinação sem nota fiscal vinculada"
                        : "✓ Todas as destinações com nota"}
                    </p>
                  ) : null}
                  <div className="dst-details__actions">
                    {currentSupplierInvoices.length > 0 ? (
                      <button type="button" className="btn btn--secondary" onClick={() => setShowViewInvoicesModal(true)}>
                        {currentSupplierInvoices.length === 1
                          ? `Ver NF ${currentSupplierInvoices[0].invoiceNumber}`
                          : `Ver ${currentSupplierInvoices.length} notas`}
                      </button>
                    ) : null}
                    {!isClosed ? (
                      <button type="button" className="btn btn--secondary" onClick={handleOpenRegisterInvoice}>
                        {currentSupplierInvoices.length > 0 ? "+ Adicionar NF" : "Registrar nota"}
                      </button>
                    ) : null}
                    <Link
                      href={`/comprador/fornecedores/${selectedSupplier.id}/faturamento`}
                      className="dst-link"
                      target="_blank"
                    >
                      Faturamento deste fornecedor ↗
                    </Link>
                  </div>
                </div>
              </details>
            ) : null}

            {/* LISTA DE PRODUTOS (SOMENTE DA LOJA ATIVA) */}
            {selectedSupplierId ? (
              <>
                {filteredProducts.length > 0 ? (
                  visibleProductViews.length > 0 ? (
                    <section className="dst-product-list" aria-label="Produtos para destinação da loja ativa">
                      {visibleProductViews.map((view) => {
                        const { prod, storeData, hasOrder, isUnpurchasedWithOrders, hasDestinedInActiveStore, status } = view;
                        const shortcutLabel = suggestionLabel({
                          orderedQuantity: storeData.orderedQuantity,
                          suggestedQuantity: storeData.suggestedQuantity,
                        });
                        const showShortcut =
                          Boolean(shortcutLabel) &&
                          hasOrder &&
                          parseQuantity(storeData.destinedQuantity) !== parseQuantity(storeData.suggestedQuantity);
                        const otherSuppliersQty = parseQuantity(storeData.destinedInOtherSuppliers);
                        const otherStoresDestined = sumQuantities(
                          stores
                            .filter((s) => s.id !== activeStoreId)
                            .map((s) => prod.stores[s.id]?.destinedQuantity ?? "0.00"),
                        );
                        const showCompact = view.isSettled && !expandedProductIds.has(prod.productId);

                        if (showCompact) {
                          return (
                            <article key={prod.productId} className="alloc-product-card dst-card dst-card--compact">
                              <div className="dst-card__info">
                                <strong className="dst-card__name">{prod.productName}</strong>
                                <span className="dst-card__line">
                                  {status.kind === "elsewhere" ? (
                                    <>
                                      Pedido {formatQty(storeData.orderedQuantity)} · comprado de outro fornecedor
                                    </>
                                  ) : (
                                    <>
                                      Pedido {formatQty(storeData.orderedQuantity)} · destinado{" "}
                                      <strong>
                                        {formatQty(storeData.destinedQuantity)} {prod.purchaseFormat}
                                      </strong>
                                    </>
                                  )}
                                </span>
                              </div>
                              <span className={`status-tag status-tag--${status.tone}`}>{status.label}</span>
                              {!isClosed ? (
                                <button
                                  type="button"
                                  className="dst-link dst-link--button"
                                  onClick={() => toggleExpanded(prod.productId)}
                                  aria-label={`Editar ${prod.productName}`}
                                >
                                  Editar
                                </button>
                              ) : null}
                            </article>
                          );
                        }

                        return (
                          <article
                            key={prod.productId}
                            className={`alloc-product-card dst-card${view.hasUnsavedChange ? " dst-card--dirty" : ""}`}
                          >
                            <header className="dst-card__head">
                              <div className="dst-card__info">
                                <span className="dst-card__erp">ERP {prod.erpCode} · {prod.purchaseFormat}</span>
                                <strong className="dst-card__name">{prod.productName}</strong>
                                {hasOrder ? (
                                  <span className="dst-card__line">
                                    Pedido da loja: <strong>{formatQty(storeData.orderedQuantity)} {prod.purchaseFormat}</strong>
                                  </span>
                                ) : null}
                                {hasOrder && otherSuppliersQty > 0 ? (
                                  <span className="dst-card__other">
                                    Já em outro fornecedor: {formatQty(storeData.destinedInOtherSuppliers)}
                                    {parseQuantity(storeData.suggestedQuantity) > 0
                                      ? ` · falta ${formatQty(storeData.suggestedQuantity)}`
                                      : ""}
                                  </span>
                                ) : null}
                                {hasOrder ? null : (
                                  <span className="dst-card__line">Sem pedido desta loja</span>
                                )}
                              </div>
                              <span className={`status-tag status-tag--${status.tone}`}>{status.label}</span>
                            </header>

                            {hasDestinedInActiveStore ||
                            prod.isExclusive ||
                            storeData.isAdditionalPurchase ||
                            prod.isAdditionalPurchase ||
                            !prod.hasOfficialCost ? (
                              <div className="dst-tags">
                                {hasDestinedInActiveStore ? (
                                  coveredProductIds.has(prod.productId) ? (
                                    <span className="dst-tag dst-tag--ok" title="Produto com nota fiscal vinculada">Com nota</span>
                                  ) : (
                                    <span className="dst-tag dst-tag--warn" title="Destinação positiva sem nota fiscal vinculada">Sem nota</span>
                                  )
                                ) : null}
                                {prod.isExclusive ? <span className="dst-tag">Exclusivo JEB</span> : null}
                                {storeData.isAdditionalPurchase || prod.isAdditionalPurchase ? (
                                  <span className="dst-tag dst-tag--info">Sem pedido / oportunidade</span>
                                ) : null}
                                {!prod.hasOfficialCost ? <span className="dst-tag">Sem custo oficial</span> : null}
                              </div>
                            ) : null}

                            {/* ALERTA: PRODUTO COM PEDIDO NÃO COMPRADO NOS CUSTOS (BUG 03) */}
                            {isUnpurchasedWithOrders ? (
                              <div className="dst-alert" role="alert">
                                <strong>Não marcado como comprado nos custos</strong>
                                <span>
                                  As lojas pediram {formatQty(prod.totalOrdered)} {prod.purchaseFormat}. Marque-o como
                                  comprado na tela de custos antes de destinar.
                                </span>
                                {hasDestinedInActiveStore ? (
                                  <button
                                    type="button"
                                    className="btn btn--danger"
                                    onClick={() => handleQuantityChange(prod.productId, "0.00")}
                                    title="Zerar destinação indevida"
                                  >
                                    Zerar destinação ({formatQty(storeData.destinedQuantity)} {prod.purchaseFormat})
                                  </button>
                                ) : (
                                  <span className="dst-text-ok">✓ Destinação zerada nesta loja.</span>
                                )}
                              </div>
                            ) : null}

                            {/* Decisão explícita de Não Comprado */}
                            {view.notPurchased ? (
                              <div className="alloc-not-purchased-banner dst-not-purchased">
                                <span className="alloc-not-purchased-banner__text">
                                  Não comprado deste fornecedor nesta loja
                                </span>
                                {!isClosed ? (
                                  <button
                                    type="button"
                                    className="alloc-btn-revert"
                                    onClick={() => handleRevertNotPurchased(prod.productId)}
                                    title="Reverter decisão e permitir nova compra ou destinação"
                                  >
                                    Desfazer
                                  </button>
                                ) : null}
                              </div>
                            ) : null}

                            <div className="dst-card__controls">
                              <div className={`dst-stepper${hasDestinedInActiveStore ? " dst-stepper--filled" : ""}`}>
                                <button
                                  type="button"
                                  className="dst-stepper__btn"
                                  disabled={isClosed}
                                  aria-label={`Diminuir ${prod.productName}`}
                                  onClick={() => handleStepQuantity(prod.productId, -1)}
                                >
                                  −
                                </button>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  className="alloc-stepper-input dst-stepper__input"
                                  aria-label={`Quantidade destinada de ${prod.productName}`}
                                  disabled={isClosed || (isUnpurchasedWithOrders && !hasDestinedInActiveStore)}
                                  value={
                                    qtyDraft?.productId === prod.productId
                                      ? qtyDraft.text
                                      : formatQty(storeData.destinedQuantity)
                                  }
                                  onFocus={(e) => {
                                    const current = formatQty(storeData.destinedQuantity);
                                    setQtyDraft({ productId: prod.productId, text: current === "0" ? "" : current });
                                    const input = e.currentTarget;
                                    requestAnimationFrame(() => input.select());
                                  }}
                                  onBlur={() => setQtyDraft(null)}
                                  onChange={(e) => {
                                    setQtyDraft({ productId: prod.productId, text: e.target.value });
                                    handleQuantityChange(prod.productId, e.target.value);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      const inputs = Array.from(
                                        document.querySelectorAll<HTMLInputElement>(".alloc-stepper-input"),
                                      );
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
                                  className="dst-stepper__btn"
                                  disabled={isClosed || isUnpurchasedWithOrders}
                                  aria-label={`Aumentar ${prod.productName}`}
                                  onClick={() => handleStepQuantity(prod.productId, 1)}
                                  title={isUnpurchasedWithOrders ? "Bloqueado: marque como comprado nos custos" : undefined}
                                >
                                  +
                                </button>
                              </div>

                              {showShortcut && !isClosed && !isUnpurchasedWithOrders ? (
                                <button
                                  type="button"
                                  className="dst-use-order"
                                  title="Preencher com o que falta destinar para esta loja"
                                  onClick={() => handleSuggestOrder(prod.productId)}
                                >
                                  {shortcutLabel}
                                </button>
                              ) : (
                                <span className="dst-card__totals">
                                  Outras lojas: <strong>{formatQty(otherStoresDestined)} {prod.purchaseFormat}</strong>
                                  <br />
                                  Total do ciclo: <strong>{formatQty(prod.totalDestined)} {prod.purchaseFormat}</strong>
                                </span>
                              )}
                            </div>

                            {prod.storeTotalDestinedAcrossSuppliers &&
                            parseQuantity(prod.storeTotalDestinedAcrossSuppliers) > 0 ? (
                              <span className="dst-card__hint">
                                Somando todos os fornecedores nesta loja:{" "}
                                <strong>{formatQty(prod.storeTotalDestinedAcrossSuppliers)} {prod.purchaseFormat}</strong>
                              </span>
                            ) : null}

                            <div className="dst-card__foot">
                              <span className="dst-card__zero-hint">0 = não comprou deste fornecedor</span>
                              {expandedProductIds.has(prod.productId) ? (
                                <button
                                  type="button"
                                  className="dst-link dst-link--button"
                                  onClick={() => toggleExpanded(prod.productId)}
                                >
                                  Recolher
                                </button>
                              ) : null}
                            </div>
                          </article>
                        );
                      })}
                    </section>
                  ) : (
                    <div className="dst-empty">
                      <span className="dst-empty__icon"><IconCheck /></span>
                      <strong>
                        {searchQuery ? "Nenhum produto pendente encontrado" : "Tudo decidido neste fornecedor"}
                      </strong>
                      <button type="button" className="dst-link dst-link--button" onClick={() => setListFilter("all")}>
                        Ver todos os {products.length} produtos
                      </button>
                    </div>
                  )
                ) : products.length > 0 ? (
                  <div className="dst-empty">
                    <strong>Nenhum produto encontrado para “{searchQuery}”.</strong>
                    <button type="button" className="dst-link dst-link--button" onClick={() => setSearchQuery("")}>
                      Limpar busca
                    </button>
                  </div>
                ) : (
                  <div className="dst-empty">
                    <strong>Nenhum produto cadastrado para este fornecedor.</strong>
                    {!isClosed ? (
                      <button
                        type="button"
                        className="btn btn--primary"
                        onClick={() => setShowAddProductModal(true)}
                      >
                        + Adicionar Produto Comprado
                      </button>
                    ) : null}
                  </div>
                )}

                {!isClosed && products.length > 0 ? (
                  <button
                    type="button"
                    className="dst-add-product"
                    onClick={() => setShowAddProductModal(true)}
                  >
                    + Adicionar outro produto deste fornecedor
                  </button>
                ) : null}

                {/* AÇÕES DO FORNECEDOR E DA LOJA */}
                {!isClosed && filteredProducts.length > 0 ? (
                  <div className="dst-actions-card">
                    <div>
                      <strong>Concluir conferência deste fornecedor</strong>
                      <p>
                        Marca os produtos sem destinação em {shortActiveStoreName} como “não comprado deste
                        fornecedor” e conclui <strong>{selectedSupplier?.displayName}</strong>.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={handleOpenBatchConcludeSupplier}
                    >
                      Concluir Conferência deste Fornecedor
                    </button>
                  </div>
                ) : null}

                <div className="dst-actions-card">
                  <div>
                    <strong>
                      {activeStoreSummary?.closureStatus === "CLOSED" ? "Cortes da loja" : "Terminou a loja?"}
                    </strong>
                    <p>
                      {activeStoreSummary?.closureStatus === "CLOSED"
                        ? `Veja os cortes enviados para ${shortActiveStoreName}.`
                        : `Confira os cortes de ${shortActiveStoreName} somando todos os fornecedores e finalize.`}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={`btn ${activeStoreSummary?.closureStatus === "CLOSED" ? "btn--secondary" : "btn--primary"}`}
                    onClick={() => handleOpenStoreClosure(activeStoreId)}
                  >
                    {activeStoreSummary?.closureStatus === "CLOSED"
                      ? "Ver cortes da loja"
                      : "Conferir Cortes e Finalizar Loja"}
                  </button>
                </div>
              </>
            ) : (
              <div className="dst-empty">
                <strong>Escolha um fornecedor para começar</strong>
                <span className="dst-subtle">
                  Você verá só os pedidos de {shortActiveStoreName} e poderá ajustar as quantidades com um toque.
                </span>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => {
                    setSupplierQuery("");
                    setShowSupplierPicker(true);
                  }}
                >
                  Escolher fornecedor
                </button>
              </div>
            )}
          </div>

          {/* RODAPÉ FIXO: SALVAR E PRÓXIMO FORNECEDOR */}
          {!isClosed && selectedSupplierId ? (
            <footer className="dst-footer">
              <span className="alloc-sticky-status dst-footer__status">
                {isDirty && canSave ? (
                  <span className="dst-text-warn">
                    <span className="dst-dot dst-dot--warn" aria-hidden="true" />
                    {pendingProducts.length === 1 ? "1 alteração não salva" : `${pendingProducts.length} alterações não salvas`}
                    <span className="visually-hidden"> — Alterações não salvas</span>
                  </span>
                ) : hasUnconfirmedSuggestions ? (
                  <span className="dst-text-warn">
                    <span className="dst-dot dst-dot--warn" aria-hidden="true" />
                    Sugestões aguardando confirmação
                  </span>
                ) : (
                  <span className="dst-text-ok">✓ Tudo salvo · {formatQty(activeStoreTotalDestined)} CX nesta loja</span>
                )}
              </span>
              <div className="dst-footer__buttons">
                <button
                  type="button"
                  className="dst-btn dst-btn--primary"
                  disabled={saving || !canSave}
                  onClick={() => handleSaveAllocations()}
                >
                  {saving ? "Salvando..." : "Salvar"}
                </button>
                {nextSupplier ? (
                  <button
                    type="button"
                    className="dst-btn dst-btn--secondary"
                    onClick={() => handleSelectSupplier(nextSupplier.id)}
                    title={`Ir para ${nextSupplier.displayName}`}
                  >
                    Próximo <IconChevronRight />
                  </button>
                ) : null}
              </div>
            </footer>
          ) : null}
        </section>
      )}

      {/* FOLHA: ESCOLHER FORNECEDOR */}
      {showSupplierPicker ? (
        <div
          className="dst-sheet-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowSupplierPicker(false);
          }}
        >
          <section className="dst-sheet" role="dialog" aria-modal="true" aria-labelledby="supplier-picker-title">
            <span className="dst-sheet__grip" aria-hidden="true" />
            <div className="dst-sheet__head">
              <div>
                <h2 id="supplier-picker-title">Fornecedores</h2>
                <span className="dst-subtle">
                  {shortActiveStoreName} · {reviewedSupplierCount} de {suppliers.length} conferidos
                </span>
              </div>
              <button
                type="button"
                className="dst-icon-btn dst-icon-btn--muted"
                aria-label="Fechar"
                onClick={() => setShowSupplierPicker(false)}
              >
                <IconClose />
              </button>
            </div>
            <label className="dst-search">
              <IconSearch />
              <input
                type="search"
                placeholder="Buscar fornecedor"
                aria-label="Buscar fornecedor"
                value={supplierQuery}
                onChange={(e) => setSupplierQuery(e.target.value)}
              />
            </label>
            <div className="dst-sheet__list">
              {pickerSuppliers.map((s) => {
                const isCurrent = s.id === selectedSupplierId;
                const isReviewed = Boolean(s.reviewedByStore?.[activeStoreId]);
                const storeVolume = s.destinedByStore[activeStoreId] ?? "0.00";
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`dst-supplier-row${isCurrent ? " dst-supplier-row--current" : ""}`}
                    onClick={() => {
                      setShowSupplierPicker(false);
                      handleSelectSupplier(s.id);
                    }}
                  >
                    <span
                      className={`dst-avatar ${isReviewed ? "dst-avatar--done" : isCurrent ? "dst-avatar--current" : "dst-avatar--pending"}`}
                      aria-hidden="true"
                    >
                      {isReviewed ? <IconCheck /> : supplierInitials(s.displayName)}
                    </span>
                    <span className="dst-supplier-row__text">
                      <strong>
                        {s.displayName}
                        {s.active ? "" : " (inativo)"}
                      </strong>
                      <span className={isReviewed ? "" : "dst-text-warn"}>
                        {isCurrent ? "Atual · " : ""}
                        {isReviewed ? "Conferido nesta loja" : "Conferência pendente"}
                      </span>
                    </span>
                    <strong className="dst-supplier-row__qty">{formatQty(storeVolume)} CX</strong>
                  </button>
                );
              })}
              {pickerSuppliers.length === 0 ? (
                <p className="dst-subtle">Nenhum fornecedor encontrado.</p>
              ) : null}
            </div>
            <p className="dst-subtle dst-sheet__note">
              Ordem: atual, depois pendentes. Fornecedores inativos não aparecem.
            </p>
          </section>
        </div>
      ) : null}

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
                  {closure.missingInvoices && closure.missingInvoices.length > 0 ? (
                    <div style={{ marginTop: "8px" }}>
                      <p style={{ margin: "2px 0 6px 0", fontSize: "12px", fontWeight: "700", color: "#991b1b" }}>
                        Destinações positivas sem nota fiscal vinculada ({closure.missingInvoices.length}):
                      </p>
                      <ul
                        style={{
                          margin: 0,
                          paddingLeft: "18px",
                          fontSize: "12px",
                          color: "#7f1d1d",
                          maxHeight: "140px",
                          overflowY: "auto",
                        }}
                      >
                        {closure.missingInvoices.map((inv, idx) => (
                          <li key={idx} style={{ marginBottom: "2px" }}>
                            <strong>{inv.storeName}</strong> • {inv.supplierName}: {inv.productName}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : (
                <>
                  <p style={{ color: "#166534", fontWeight: "600" }}>
                    ✓ Todas as lojas ({stores.length}) foram conferidas e finalizadas sem pendências, e todos os produtos comprados possuem destinação atribuída.
                  </p>
                  {closure.missingInvoices && closure.missingInvoices.length > 0 ? (
                    <div
                      style={{
                        marginTop: "8px",
                        padding: "8px 12px",
                        backgroundColor: "#fef3c7",
                        borderRadius: "6px",
                        border: "1px solid #fde68a",
                      }}
                    >
                      <p style={{ margin: "0 0 4px 0", fontSize: "12px", fontWeight: "700", color: "#92400e" }}>
                        ℹ️ Fase de homologação de notas fiscais:
                      </p>
                      <p style={{ margin: 0, fontSize: "12px", color: "#78350f" }}>
                        Existem {closure.missingInvoices.length} destinação(ões) positiva(s) sem nota fiscal vinculada. O fechamento é permitido nesta etapa de transição, mas recomenda-se registrar as notas antes de finalizar.
                      </p>
                    </div>
                  ) : null}
                </>
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
              <h2>
                Produtos Comprados sem Fornecedor{unassignedStoreLabel ? ` — ${unassignedStoreLabel}` : ""} ({unassignedPurchasedProducts.length})
              </h2>
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
                Itens pedidos por <strong>{unassignedStoreLabel || "esta loja"}</strong> e marcados como comprados
                nos custos, mas ainda sem destinação para esta loja (nem marcados como “Não comprado”):
              </p>
              {unassignedPurchasedProducts.length === 0 ? (
                <p style={{ fontSize: "13px", color: "#15803d", fontWeight: 600 }}>✓ Nenhum item pendente nesta loja.</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px" }}>
                  {unassignedPurchasedProducts.map((p) => (
                    <li key={p.id} style={{ marginBottom: "6px" }}>
                      <strong>[{p.erpCode}] {p.name}</strong> ({p.purchaseFormat})
                    </li>
                  ))}
                </ul>
              )}
              {unassignedOpportunityProducts.length > 0 ? (
                <>
                  <p style={{ marginTop: "16px" }}>
                    Comprados que <strong>nenhuma loja pediu</strong> e ainda sem destinação em nenhuma loja:
                  </p>
                  <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px" }}>
                    {unassignedOpportunityProducts.map((p) => (
                      <li key={p.id} style={{ marginBottom: "6px" }}>
                        <strong>[{p.erpCode}] {p.name}</strong> ({p.purchaseFormat})
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
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

      {/* TELA: CONFERIR CORTES E FINALIZAR LOJA */}
      {showStoreClosureModal ? (
        <div className="alloc-modal-backdrop dst-fullscreen-backdrop" role="dialog" aria-modal="true" aria-labelledby="store-closure-title">
          <div className="alloc-modal dst-fullscreen">
            <header className="dst-head dst-fullscreen__head">
              <div className="dst-head__row">
                <button
                  type="button"
                  className="dst-icon-btn"
                  aria-label="Voltar para produtos"
                  onClick={() => {
                    setShowStoreClosureModal(false);
                    setStoreCloseError(null);
                  }}
                >
                  <IconChevronLeft />
                </button>
                <div className="dst-head__titles">
                  <span className="dst-eyebrow">
                    {shortStoreName(targetStore.name)} · Compra {cycleLabel}
                  </span>
                  <h2 id="store-closure-title" className="dst-title">Conferir cortes</h2>
                </div>
              </div>
            </header>

            <div className="dst-fullscreen__body">
              {targetStoreClosure?.status === "CLOSED" && !targetStoreClosure.isStale ? (
                <div className="dst-callout dst-callout--ok" role="status">
                  <IconCheck />
                  <span>
                    Loja finalizada em{" "}
                    {targetStoreClosure.closedAt ? new Date(targetStoreClosure.closedAt).toLocaleString("pt-BR") : ""} por{" "}
                    {targetStoreClosure.closedByName ?? "Comprador"}
                  </span>
                </div>
              ) : targetStoreClosure?.status === "CLOSED" && targetStoreClosure.isStale ? (
                <div className="dst-callout dst-callout--warn" role="status">
                  <IconAlert />
                  <span>
                    Conferência desatualizada: {(targetStoreClosure.staleReason ?? "houve alterações posteriores").replace(/\.$/, "")}. Confirme de novo.
                  </span>
                </div>
              ) : null}

              <div className="dst-kpis">
                <div className="dst-kpi">
                  <span>Pedidos</span>
                  <strong>{targetStoreClosure?.totalOrderedItems ?? 0}</strong>
                </div>
                <div className="dst-kpi dst-kpi--ok">
                  <span>Atendidos</span>
                  <strong>{closureItems.fulfilled.length}</strong>
                </div>
                <div className={`dst-kpi ${(targetStoreClosure?.totalCutItems ?? 0) > 0 ? "dst-kpi--danger" : ""}`}>
                  <span>Cortes</span>
                  <strong>{targetStoreClosure?.totalCutItems ?? 0}</strong>
                </div>
              </div>

              <p className="dst-subtle">
                Confira os cortes antes de finalizar. A soma inclui todos os fornecedores e a loja verá estas quantidades na
                conferência. Se pedidos ou destinações mudarem depois, será preciso confirmar de novo.
              </p>

              {closureGapsBlocking.length > 0 ? (
                <section className="dst-gap dst-gap--block" aria-label="Comprados sem destino">
                  <header>
                    <IconAlert />
                    <strong>Comprado sem destino · impede finalizar</strong>
                  </header>
                  <ul>
                    {closureGapsBlocking.map((gap) => (
                      <li key={gap.productId}>
                        <span>
                          <strong>{gap.productName}</strong>
                          <small>
                            Pedido {formatQty(gap.orderedQuantity)} {gap.purchaseFormat} · marcado como comprado, 0 em todos os fornecedores
                          </small>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p>Informe de quem comprou e quanto. Se não comprou, desmarque nos custos.</p>
                </section>
              ) : null}

              {closureGapsToConfirm.length > 0 ? (
                <section
                  id="closure-confirm-cuts"
                  className="dst-gap dst-gap--confirm"
                  aria-label="Comprados que não foram para esta loja"
                >
                  <header>
                    <strong>
                      Comprado, mas sem quantidade para {shortStoreName(targetStore.name)} ({closureGapsToConfirm.length})
                    </strong>
                  </header>
                  <ul>
                    {closureGapsToConfirm.map((gap) => (
                      <li key={gap.productId}>
                        <span>
                          <strong>{gap.productName}</strong>
                          <small>
                            Pedido {formatQty(gap.orderedQuantity)} {gap.purchaseFormat} · foi para outras lojas
                          </small>
                        </span>
                        <span className="status-tag status-tag--total">Corte total</span>
                      </li>
                    ))}
                  </ul>
                  {!isClosed ? (
                    <label className="dst-gap__confirm">
                      <input
                        type="checkbox"
                        checked={confirmZeroCuts}
                        onChange={(e) => setConfirmZeroCuts(e.target.checked)}
                      />
                      Confirmo que estes produtos não vão para {shortStoreName(targetStore.name)}
                    </label>
                  ) : null}
                </section>
              ) : null}

              {closureItems.attention.length > 0 ? (
                <ul className="dst-cut-list" aria-label="Cortes e adicionais">
                  {closureItems.attention.map((cut) => {
                    const tag = closureItemTag(cut);
                    return (
                      <li key={cut.productId} className="dst-cut-row">
                        <span className="dst-cut-row__text">
                          <strong>{cut.productName}</strong>
                          <span>{tag.detail}</span>
                        </span>
                        <span className={`status-tag status-tag--${tag.tone}`}>{tag.label}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (targetStoreClosure?.cuts ?? []).length === 0 ? (
                <div className="dst-empty">
                  <strong>Nenhum produto pedido ou destinado para esta loja neste ciclo.</strong>
                </div>
              ) : (
                <div className="dst-callout dst-callout--ok">
                  <IconCheck />
                  <span>Nenhum corte: todos os pedidos foram atendidos.</span>
                </div>
              )}

              {closureItems.fulfilled.length > 0 ? (
                <>
                  <button
                    type="button"
                    className="dst-link dst-link--button"
                    aria-expanded={showFulfilledCuts}
                    onClick={() => setShowFulfilledCuts((open) => !open)}
                  >
                    {showFulfilledCuts
                      ? "Ocultar itens atendidos"
                      : `Ver os ${closureItems.fulfilled.length} itens atendidos`}
                  </button>
                  {showFulfilledCuts ? (
                    <ul className="dst-cut-list" aria-label="Itens atendidos">
                      {closureItems.fulfilled.map((cut) => {
                        const tag = closureItemTag(cut);
                        return (
                          <li key={cut.productId} className="dst-cut-row">
                            <span className="dst-cut-row__text">
                              <strong>{cut.productName}</strong>
                              <span>{tag.detail}</span>
                            </span>
                            <span className={`status-tag status-tag--${tag.tone}`}>{tag.label}</span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </>
              ) : null}

              {storeCloseError ? (
                <div className="dst-callout dst-callout--danger" role="alert">
                  <IconAlert />
                  <span>{storeCloseError}</span>
                </div>
              ) : null}

              {targetStoreClosure?.status === "CLOSED" && !targetStoreClosure.isStale && !isClosed ? (
                <button
                  type="button"
                  className="dst-link dst-link--danger dst-link--button"
                  onClick={() => {
                    setShowStoreClosureModal(false);
                    setShowReopenStoreModal(true);
                  }}
                >
                  Reabrir conferência desta loja
                </button>
              ) : null}
            </div>

            <footer className="dst-footer dst-footer--stack">
              {/* A confirmação fica também junto do botão: com a lista rolada, o
                  quadro laranja some da tela e o comprador não via o que faltava. */}
              {!isClosed &&
              closureGapsBlocking.length === 0 &&
              closureGapsToConfirm.length > 0 &&
              !(targetStoreClosure?.status === "CLOSED" && !targetStoreClosure.isStale) ? (
                <div className="dst-footer__confirm">
                  <label>
                    <input
                      type="checkbox"
                      checked={confirmZeroCuts}
                      onChange={(e) => setConfirmZeroCuts(e.target.checked)}
                    />
                    <span>
                      Confirmo o corte de {closureGapsToConfirm.length}{" "}
                      {closureGapsToConfirm.length === 1 ? "produto comprado" : "produtos comprados"} sem quantidade
                      para {shortStoreName(targetStore.name)}:{" "}
                      <strong>{closureGapsToConfirm.map((g) => g.productName).join(", ")}</strong>
                    </span>
                  </label>
                </div>
              ) : null}
              {!isClosed && !(targetStoreClosure?.status === "CLOSED" && !targetStoreClosure.isStale) ? (
                <button
                  type="button"
                  className="dst-btn dst-btn--primary dst-btn--lg"
                  disabled={closingStore || closureBlocked}
                  onClick={handleConfirmCloseStore}
                >
                  <IconCheck />
                  {closingStore
                    ? "Finalizando..."
                    : closureGapsBlocking.length > 0
                      ? `Destine ${closureGapsBlocking.length} ${closureGapsBlocking.length === 1 ? "produto" : "produtos"} para finalizar`
                      : closureGapsToConfirm.length > 0 && !confirmZeroCuts
                        ? "Marque a confirmação para finalizar"
                        : targetStoreClosure?.status === "CLOSED" && targetStoreClosure.isStale
                      ? "Reconfirmar cortes e finalizar loja"
                      : "Confirmar cortes e finalizar loja"}
                </button>
              ) : null}
              <button
                type="button"
                className="dst-btn dst-btn--ghost"
                onClick={() => {
                  setShowStoreClosureModal(false);
                  setStoreCloseError(null);
                }}
              >
                {!isClosed && !(targetStoreClosure?.status === "CLOSED" && !targetStoreClosure.isStale)
                  ? "Finalizar depois"
                  : "Fechar"}
              </button>
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
                          <Image
                            src={invoicePreviewUrl}
                            alt="Prévia da Nota Fiscal"
                            width={1600}
                            height={1600}
                            unoptimized
                            style={{ width: "auto", height: "auto", maxHeight: "200px", maxWidth: "100%", objectFit: "contain", borderRadius: "4px" }}
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
                    preparingInvoicePhoto ||
                    !invoiceNumberInput.trim() ||
                    !invoiceFile ||
                    destinedProductsForSupplierAndStore.length === 0 ||
                    selectedInvoiceProductIds.length === 0
                  }
                >
                  {preparingInvoicePhoto ? "Preparando foto..." : registeringInvoice ? "Salvando Nota..." : "Salvar Nota Fiscal"}
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
                          <Image
                            src={`/api/invoices/${inv.id}/image`}
                            alt={`NF ${inv.invoiceNumber}`}
                            width={56}
                            height={56}
                            unoptimized
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
                          {inv.itemProductIds && inv.itemProductIds.length > 0 ? (
                            <div style={{ fontSize: "12px", color: "#0369a1", marginTop: "3px" }}>
                              <strong>Produtos vinculados:</strong>{" "}
                              {inv.itemProductIds
                                .map((pid) => products.find((p) => p.productId === pid)?.productName || pid)
                                .join(", ")}
                            </div>
                          ) : null}
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
                  {unlinkedDestinedProducts.length > 0 ? (
                    <div
                      style={{
                        marginTop: "8px",
                        padding: "10px 12px",
                        backgroundColor: "#fffbeb",
                        border: "1px solid #fde68a",
                        borderRadius: "6px",
                        fontSize: "12px",
                      }}
                    >
                      <strong style={{ color: "#92400e" }}>
                        ⚠️ Produtos destinados ainda sem nota fiscal ({unlinkedDestinedProducts.length}):
                      </strong>
                      <div style={{ color: "#78350f", marginTop: "4px" }}>
                        {unlinkedDestinedProducts.map((p) => p.productName).join(", ")}
                      </div>
                    </div>
                  ) : null}
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
            <Image
              src={viewingPhotoUrl}
              alt="Fotografia da Nota Fiscal"
              width={1600}
              height={1600}
              unoptimized
              style={{
                width: "auto",
                height: "auto",
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
