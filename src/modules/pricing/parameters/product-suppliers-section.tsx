"use client";

import { useEffect, useState, useTransition } from "react";
import { formatTaxId } from "@/modules/suppliers/domain";
import type { Supplier } from "@/modules/suppliers/domain";
import type { ProductSupplierLink } from "@/modules/suppliers/product-suppliers-domain";
import { listActiveSuppliersAction } from "@/modules/suppliers/actions";
import {
  linkSupplierAction,
  listProductSuppliersAction,
  setPrimarySupplierAction,
  toggleExclusivityAction,
  unlinkSupplierAction,
} from "@/modules/suppliers/product-suppliers-actions";

export function ProductSuppliersSection({
  productId,
  erpCode,
  productName,
  onExclusiveChanged,
}: {
  productId: string;
  erpCode: number;
  productName: string;
  onExclusiveChanged?: (isExclusive: boolean) => void;
}) {
  const [links, setLinks] = useState<ProductSupplierLink[]>([]);
  const [availableSuppliers, setAvailableSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [isExclusive, setIsExclusive] = useState(false);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  async function loadData() {
    setLoading(true);
    try {
      const res = await listProductSuppliersAction(productId);
      if (res.status === "success") {
        setLinks(res.suppliers);
      }
    } catch {
      setFeedback({ type: "error", message: "Erro ao carregar fornecedores do produto." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    listProductSuppliersAction(productId)
      .then((res) => {
        if (!active) return;
        if (res.status === "success") {
          setLinks(res.suppliers);
        } else {
          setFeedback({ type: "error", message: res.message });
        }
      })
      .catch(() => {
        if (!active) return;
        setFeedback({ type: "error", message: "Erro ao carregar fornecedores do produto." });
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    listActiveSuppliersAction().then((res) => {
      if (active && res.status === "success") {
        setAvailableSuppliers(res.suppliers);
      }
    });

    return () => {
      active = false;
    };
  }, [productId]);

  function handleLink(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSupplierId) return;

    setFeedback(null);
    startTransition(async () => {
      const res = await linkSupplierAction({
        productId,
        supplierId: selectedSupplierId,
        isPrimary,
        isExclusive,
        notes: notes.trim() || null,
      });

      if (res.status === "success") {
        setFeedback({ type: "success", message: "Fornecedor vinculado com sucesso!" });
        setSelectedSupplierId("");
        setIsPrimary(false);
        setIsExclusive(false);
        setNotes("");
        await loadData();
        if (isExclusive && onExclusiveChanged) {
          onExclusiveChanged(true);
        }
      } else {
        setFeedback({ type: "error", message: res.message });
      }
    });
  }

  function handleUnlink(supplierId: string, supplierName: string) {
    if (!window.confirm(`Deseja desvincular o fornecedor '${supplierName}' deste produto?`)) {
      return;
    }

    setFeedback(null);
    startTransition(async () => {
      const res = await unlinkSupplierAction({ productId, supplierId });
      if (res.status === "success") {
        setFeedback({ type: "success", message: "Fornecedor desvinculado com sucesso." });
        await loadData();
      } else {
        setFeedback({ type: "error", message: res.message });
      }
    });
  }

  function handleSetPrimary(supplierId: string) {
    setFeedback(null);
    startTransition(async () => {
      const res = await setPrimarySupplierAction({
        productId,
        supplierId,
        isExclusive: false,
      });
      if (res.status === "success") {
        setFeedback({ type: "success", message: "Fornecedor principal atualizado com sucesso." });
        await loadData();
      } else {
        setFeedback({ type: "error", message: res.message });
      }
    });
  }

  function handleToggleExclusivity(supplierId: string, currentlyExclusive: boolean) {
    const nextExclusive = !currentlyExclusive;
    setFeedback(null);
    startTransition(async () => {
      const res = await toggleExclusivityAction({
        productId,
        supplierId,
        isExclusive: nextExclusive,
      });
      if (res.status === "success") {
        setFeedback({
          type: "success",
          message: nextExclusive
            ? "Fornecedor definido como exclusivo para novas compras."
            : "Exclusividade removida com sucesso.",
        });
        await loadData();
        if (onExclusiveChanged) {
          onExclusiveChanged(nextExclusive);
        }
      } else {
        setFeedback({ type: "error", message: res.message });
      }
    });
  }

  // Filtra fornecedores que ainda não estão vinculados
  const unlinkedSuppliers = availableSuppliers.filter(
    (sup) => !links.some((l) => l.supplierId === sup.id)
  );

  return (
    <fieldset className="manager-form-section">
      <legend>Fornecedores vinculados — {productName} (ERP {erpCode})</legend>

      {feedback ? (
        <p
          role="status"
          className={`manager-feedback ${
            feedback.type === "success"
              ? "manager-feedback--success"
              : "manager-feedback--error"
          }`}
          style={{ marginBottom: 16 }}
        >
          {feedback.message}
        </p>
      ) : null}

      {/* Lista de Vínculos Existentes */}
      {loading ? (
        <p style={{ fontSize: "0.85rem", color: "#64748b" }}>Carregando fornecedores vinculados...</p>
      ) : links.length > 0 ? (
        <div className="product-suppliers-list" style={{ marginBottom: 20 }}>
          <table
            className="manager-table"
            style={{ width: "100%", fontSize: "0.82rem", marginBottom: 12 }}
          >
            <thead>
              <tr>
                <th>Fornecedor</th>
                <th>Doc. Fiscal</th>
                <th>Regra NF</th>
                <th style={{ textAlign: "center" }}>Status</th>
                <th style={{ textAlign: "right" }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {links.map((link) => (
                <tr key={link.id}>
                  <td>
                    <strong>{link.corporateName}</strong>
                    {link.tradeName ? (
                      <span style={{ display: "block", color: "#64748b", fontSize: "0.75rem" }}>
                        Fantasia: {link.tradeName}
                      </span>
                    ) : null}
                  </td>
                  <td>{link.taxId ? formatTaxId(link.taxId) : "—"}</td>
                  <td>
                    <span style={{ fontSize: "0.75rem" }}>
                      {link.taxInvoiceRule === "STANDARD"
                        ? "Normal"
                        : link.taxInvoiceRule === "AFTER_WEIGHING"
                        ? "Após pesagem"
                        : "Reg. especial"}
                    </span>
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <div style={{ display: "flex", gap: 4, justifyContent: "center", flexWrap: "wrap" }}>
                      {link.isExclusive ? (
                        <span
                          className="manager-badge manager-badge--info"
                          title="Somente este fornecedor pode atender novas compras deste produto"
                        >
                          EXCLUSIVO
                        </span>
                      ) : link.isPrimary ? (
                        <span
                          className="manager-badge manager-badge--configured"
                          title="Fornecedor padrão sugerido para compras"
                        >
                          PRINCIPAL
                        </span>
                      ) : (
                        <span className="manager-badge manager-badge--neutral">
                          Alternativo
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      {!link.isPrimary && !link.isExclusive ? (
                        <button
                          type="button"
                          className="manager-secondary"
                          style={{ padding: "2px 8px", fontSize: "0.75rem" }}
                          disabled={pending}
                          onClick={() => handleSetPrimary(link.supplierId)}
                        >
                          Definir principal
                        </button>
                      ) : null}

                      <button
                        type="button"
                        className="manager-secondary"
                        style={{ padding: "2px 8px", fontSize: "0.75rem" }}
                        disabled={pending}
                        onClick={() => handleToggleExclusivity(link.supplierId, link.isExclusive)}
                      >
                        {link.isExclusive ? "Desativar exclusividade" : "Tornar exclusivo"}
                      </button>

                      <button
                        type="button"
                        className="manager-secondary"
                        style={{ padding: "2px 8px", fontSize: "0.75rem", color: "#dc2626" }}
                        disabled={pending}
                        onClick={() => handleUnlink(link.supplierId, link.corporateName)}
                      >
                        Desvincular
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p style={{ fontSize: "0.85rem", color: "#64748b", marginBottom: 16 }}>
          Nenhum fornecedor vinculado a este produto ainda. O comprador poderá selecionar qualquer fornecedor no ato da compra.
        </p>
      )}

      {/* Formulário para Vincular Novo Fornecedor */}
      {unlinkedSuppliers.length > 0 ? (
        <div
          style={{
            padding: 12,
            backgroundColor: "#f8fafc",
            borderRadius: 6,
            border: "1px solid #e2e8f0",
          }}
        >
          <strong style={{ display: "block", fontSize: "0.82rem", marginBottom: 8 }}>
            + Vincular novo fornecedor
          </strong>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <label className="manager-field">
              <span>Selecione o fornecedor</span>
              <select
                value={selectedSupplierId}
                onChange={(e) => setSelectedSupplierId(e.target.value)}
                disabled={pending}
              >
                <option value="">Selecione na lista de fornecedores ativos...</option>
                {unlinkedSuppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.corporateName} {s.tradeName ? `(${s.tradeName})` : ""} {s.taxId ? `— ${formatTaxId(s.taxId)}` : ""}
                  </option>
                ))}
              </select>
            </label>

            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <label className="manager-check">
                <input
                  type="checkbox"
                  checked={isPrimary || isExclusive}
                  disabled={isExclusive || pending}
                  onChange={(e) => setIsPrimary(e.target.checked)}
                />
                Fornecedor principal
              </label>

              <label className="manager-check">
                <input
                  type="checkbox"
                  checked={isExclusive}
                  disabled={pending}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setIsExclusive(checked);
                    if (checked) setIsPrimary(true);
                  }}
                />
                Fornecedor exclusivo (bloqueia compras de outros fornecedores)
              </label>
            </div>

            <div>
              <button
                type="button"
                className="manager-primary"
                disabled={!selectedSupplierId || pending}
                onClick={handleLink}
                style={{ fontSize: "0.82rem", padding: "6px 14px" }}
              >
                {pending ? "Vinculando..." : "Vincular ao produto"}
              </button>
            </div>
          </div>
        </div>
      ) : availableSuppliers.length > 0 ? (
        <p style={{ fontSize: "0.8rem", color: "#64748b" }}>
          Todos os fornecedores ativos cadastrados já estão vinculados a este produto.
        </p>
      ) : null}
    </fieldset>
  );
}
