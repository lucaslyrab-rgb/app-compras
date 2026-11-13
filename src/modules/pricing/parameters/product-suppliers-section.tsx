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
  onCountChanged,
}: {
  productId: string;
  erpCode: number;
  productName: string;
  onExclusiveChanged?: (isExclusive: boolean) => void;
  /** Quantidade de fornecedores vinculados (para o título da aba). */
  onCountChanged?: (count: number) => void;
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
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [showLinkForm, setShowLinkForm] = useState(false);

  useEffect(() => {
    if (!loading) onCountChanged?.(links.length);
  }, [links.length, loading, onCountChanged]);

  // A exclusividade do produto segue os vínculos (a caixa antiga saiu do painel).
  // Sem nenhum vínculo, mantém a marcação que veio do cadastro.
  const hasExclusiveLink = links.some((link) => link.active && link.isExclusive);
  useEffect(() => {
    if (!loading && links.length > 0) onExclusiveChanged?.(hasExclusiveLink);
  }, [hasExclusiveLink, links.length, loading, onExclusiveChanged]);

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
        setShowLinkForm(false);
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
    setOpenMenu(null);
    if (!window.confirm(`Deseja desvincular o fornecedor '${supplierName}' deste produto?`)) {
      return;
    }

    setFeedback(null);
    startTransition(async () => {
      const wasExclusive = links.some((link) => link.supplierId === supplierId && link.isExclusive);
      const res = await unlinkSupplierAction({ productId, supplierId });
      if (res.status === "success") {
        if (wasExclusive) onExclusiveChanged?.(false);
        setFeedback({ type: "success", message: "Fornecedor desvinculado com sucesso." });
        await loadData();
      } else {
        setFeedback({ type: "error", message: res.message });
      }
    });
  }

  function handleSetPrimary(supplierId: string) {
    setOpenMenu(null);
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
    setOpenMenu(null);
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
    <fieldset className="manager-form-section product-suppliers">
      <legend className="visually-hidden">Fornecedores vinculados — {productName} (ERP {erpCode})</legend>

      {feedback ? (
        <p
          role="status"
          className={`manager-feedback ${feedback.type === "success" ? "manager-feedback--success" : "manager-feedback--error"}`}
        >
          {feedback.message}
        </p>
      ) : null}

      {loading ? (
        <p className="product-suppliers__hint">Carregando fornecedores vinculados…</p>
      ) : links.length > 0 ? (
        <ul className="product-suppliers__list" aria-label="Fornecedores vinculados">
          {links.map((link) => {
            const menuOpen = openMenu === link.id;
            return (
              <li key={link.id} className="product-suppliers__row">
                <span className="product-suppliers__identity">
                  <strong>{link.tradeName || link.corporateName}</strong>
                  <small>
                    {link.tradeName ? `${link.corporateName} · ` : ""}
                    {link.taxId ? formatTaxId(link.taxId) : "sem documento"}
                  </small>
                </span>
                <span className="product-suppliers__badges">
                  {link.isPrimary || link.isExclusive ? <span className="manager-badge manager-badge--configured">Principal</span> : null}
                  {link.isExclusive ? <span className="manager-badge manager-badge--warning">Exclusivo</span> : null}
                  {!link.isPrimary && !link.isExclusive ? <span className="manager-badge manager-badge--neutral">Alternativo</span> : null}
                </span>
                <span className="product-suppliers__menu">
                  <button
                    type="button"
                    className="manager-icon-button"
                    aria-label={`Ações do fornecedor ${link.tradeName || link.corporateName}`}
                    aria-expanded={menuOpen}
                    disabled={pending}
                    onClick={() => setOpenMenu(menuOpen ? null : link.id)}
                  >
                    ⋯
                  </button>
                  {menuOpen ? (
                    <span className="product-suppliers__menu-list" role="menu">
                      {!link.isPrimary && !link.isExclusive ? (
                        <button type="button" role="menuitem" onClick={() => handleSetPrimary(link.supplierId)}>
                          Definir como principal
                        </button>
                      ) : null}
                      <button type="button" role="menuitem" onClick={() => handleToggleExclusivity(link.supplierId, link.isExclusive)}>
                        {link.isExclusive ? "Desativar exclusividade" : "Tornar exclusivo"}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="product-suppliers__danger"
                        onClick={() => handleUnlink(link.supplierId, link.corporateName)}
                      >
                        Desvincular fornecedor
                      </button>
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="product-suppliers__hint">
          Nenhum fornecedor vinculado. O comprador pode escolher qualquer fornecedor na compra.
        </p>
      )}

      {unlinkedSuppliers.length > 0 ? (
        showLinkForm ? (
          <div className="product-suppliers__link-form">
            <label className="manager-field">
              <span>Fornecedor</span>
              <select value={selectedSupplierId} onChange={(e) => setSelectedSupplierId(e.target.value)} disabled={pending}>
                <option value="">Selecione na lista de fornecedores ativos…</option>
                {unlinkedSuppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.tradeName || s.corporateName}
                    {s.taxId ? ` — ${formatTaxId(s.taxId)}` : ""}
                  </option>
                ))}
              </select>
            </label>
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
              <span>
                Fornecedor exclusivo
                <small className="manager-check__hint">Bloqueia compras deste produto de outros fornecedores.</small>
              </span>
            </label>
            <div className="product-suppliers__link-actions">
              <button type="button" className="manager-secondary" disabled={pending} onClick={() => setShowLinkForm(false)}>
                Cancelar
              </button>
              <button type="button" className="manager-primary" disabled={!selectedSupplierId || pending} onClick={handleLink}>
                {pending ? "Vinculando…" : "Vincular"}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="product-suppliers__add" disabled={pending} onClick={() => setShowLinkForm(true)}>
            + Vincular fornecedor
          </button>
        )
      ) : availableSuppliers.length > 0 ? (
        <p className="product-suppliers__hint">Todos os fornecedores ativos já estão vinculados a este produto.</p>
      ) : null}
    </fieldset>
  );
}
