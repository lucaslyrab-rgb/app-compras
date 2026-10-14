"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { Role } from "@/modules/identity";
import {
  createSupplierAction,
  toggleSupplierActiveAction,
  updateSupplierAction,
} from "./actions";
import { listSupplierProductsAction } from "./product-suppliers-actions";
import type { SupplierProductLink } from "./product-suppliers-domain";
import {
  formatPhone,
  formatTaxId,
  normalizePhone,
  normalizeTaxId,
  TAX_ID_TYPE_LABELS,
  TAX_INVOICE_RULE_LABELS,
  type Supplier,
  type TaxInvoiceRule,
  validateTaxId,
} from "./domain";
import "./styles.css";

export function SupplierWorkspace({
  initialSuppliers,
  role,
  canToggleStatus,
}: {
  initialSuppliers: Supplier[];
  role: Role;
  canToggleStatus: boolean;
}) {
  const [suppliers, setSuppliers] = useState<Supplier[]>(initialSuppliers);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");
  const [ruleFilter, setRuleFilter] = useState<"ALL" | TaxInvoiceRule>("ALL");

  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  // Modals state
  const [isCreating, setIsCreating] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);

  // Form states
  const [createForm, setCreateForm] = useState({
    corporateName: "",
    tradeName: "",
    taxId: "",
    taxInvoiceRule: "STANDARD" as TaxInvoiceRule,
    contactName: "",
    contactPhone: "",
    notes: "",
  });

  const [editForm, setEditForm] = useState({
    corporateName: "",
    tradeName: "",
    taxId: "",
    taxInvoiceRule: "STANDARD" as TaxInvoiceRule,
    contactName: "",
    contactPhone: "",
    notes: "",
  });

  const [formError, setFormError] = useState<string | null>(null);
  const [linkedProducts, setLinkedProducts] = useState<SupplierProductLink[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);

  const editingSupplierId = editingSupplier?.id;

  useEffect(() => {
    if (!editingSupplierId) return;
    let active = true;
    listSupplierProductsAction(editingSupplierId)
      .then((res) => {
        if (active && res.status === "success") {
          setLinkedProducts(res.products);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setIsLoadingProducts(false);
      });
    return () => {
      active = false;
    };
  }, [editingSupplierId]);

  // Auto-masking helpers for inputs
  function maskTaxIdInput(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 14);
    if (digits.length <= 11) {
      return digits
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    }
    return digits
      .replace(/(\d{2})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1/$2")
      .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
  }

  function maskPhoneInput(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 11);
    if (digits.length <= 10) {
      return digits
        .replace(/(\d{2})(\d)/, "($1) $2")
        .replace(/(\d{4})(\d{1,4})$/, "$1-$2");
    }
    return digits
      .replace(/(\d{2})(\d)/, "($1) $2")
      .replace(/(\d{5})(\d{1,4})$/, "$1-$2");
  }

  // Filtered suppliers
  const filteredSuppliers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");

    return suppliers.filter((s) => {
      const matchSearch =
        !q ||
        s.corporateName.toLowerCase().includes(q) ||
        (s.tradeName && s.tradeName.toLowerCase().includes(q)) ||
        (s.taxId && s.taxId.includes(qDigits)) ||
        (s.contactName && s.contactName.toLowerCase().includes(q));

      const matchStatus =
        statusFilter === "ALL" ||
        (statusFilter === "ACTIVE" && s.active) ||
        (statusFilter === "INACTIVE" && !s.active);

      const matchRule = ruleFilter === "ALL" || s.taxInvoiceRule === ruleFilter;

      return matchSearch && matchStatus && matchRule;
    });
  }, [suppliers, search, statusFilter, ruleFilter]);

  // Metrics
  const metrics = useMemo(() => {
    const total = suppliers.length;
    const active = suppliers.filter((s) => s.active).length;
    const inactive = total - active;
    const weighing = suppliers.filter((s) => s.taxInvoiceRule === "AFTER_WEIGHING").length;
    const special = suppliers.filter((s) => s.taxInvoiceRule === "SPECIAL_REGIME").length;
    return { total, active, inactive, weighing, special };
  }, [suppliers]);

  function handleOpenCreate() {
    setCreateForm({
      corporateName: "",
      tradeName: "",
      taxId: "",
      taxInvoiceRule: "STANDARD",
      contactName: "",
      contactPhone: "",
      notes: "",
    });
    setFormError(null);
    setIsCreating(true);
  }

  function handleOpenEdit(supplier: Supplier) {
    setEditingSupplier(supplier);
    setLinkedProducts([]);
    setIsLoadingProducts(true);
    setEditForm({
      corporateName: supplier.corporateName,
      tradeName: supplier.tradeName ?? "",
      taxId: formatTaxId(supplier.taxId),
      taxInvoiceRule: supplier.taxInvoiceRule,
      contactName: supplier.contactName ?? "",
      contactPhone: formatPhone(supplier.contactPhone),
      notes: supplier.notes ?? "",
    });
    setFormError(null);
  }

  function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFeedback(null);

    const corporateName = createForm.corporateName.trim();
    if (!corporateName) {
      setFormError("Informe a razão social.");
      return;
    }

    const normalizedTaxId = normalizeTaxId(createForm.taxId);
    if (normalizedTaxId) {
      const taxValidation = validateTaxId(normalizedTaxId);
      if (!taxValidation.valid) {
        setFormError(taxValidation.reason ?? "Documento fiscal inválido.");
        return;
      }
    }

    startTransition(async () => {
      const res = await createSupplierAction({
        corporateName,
        tradeName: createForm.tradeName.trim() || null,
        taxId: normalizedTaxId,
        taxInvoiceRule: createForm.taxInvoiceRule,
        contactName: createForm.contactName.trim() || null,
        contactPhone: normalizePhone(createForm.contactPhone),
        notes: createForm.notes.trim() || null,
      });

      if (res.status === "success") {
        setSuppliers((prev) => [res.supplier, ...prev]);
        setIsCreating(false);
        setFeedback({
          type: "success",
          message: `Fornecedor "${res.supplier.corporateName}" cadastrado com sucesso!`,
        });
      } else {
        setFormError(res.message);
      }
    });
  }

  function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingSupplier) return;
    setFormError(null);
    setFeedback(null);

    const corporateName = editForm.corporateName.trim();
    if (!corporateName) {
      setFormError("Informe a razão social.");
      return;
    }

    const normalizedTaxId = normalizeTaxId(editForm.taxId);
    if (normalizedTaxId) {
      const taxValidation = validateTaxId(normalizedTaxId);
      if (!taxValidation.valid) {
        setFormError(taxValidation.reason ?? "Documento fiscal inválido.");
        return;
      }
    }

    startTransition(async () => {
      const res = await updateSupplierAction({
        id: editingSupplier.id,
        corporateName,
        tradeName: editForm.tradeName.trim() || null,
        taxId: normalizedTaxId,
        taxInvoiceRule: editForm.taxInvoiceRule,
        contactName: editForm.contactName.trim() || null,
        contactPhone: normalizePhone(editForm.contactPhone),
        notes: editForm.notes.trim() || null,
        expectedVersion: editingSupplier.version,
      });

      if (res.status === "success") {
        setSuppliers((prev) =>
          prev.map((s) => (s.id === res.supplier.id ? res.supplier : s))
        );
        setEditingSupplier(null);
        setFeedback({
          type: "success",
          message: `Fornecedor "${res.supplier.corporateName}" atualizado com sucesso!`,
        });
      } else {
        setFormError(res.message);
      }
    });
  }

  function handleToggleStatus(supplier: Supplier) {
    if (!canToggleStatus) return;
    setFeedback(null);

    const actionText = supplier.active ? "desativar" : "ativar";
    if (
      !window.confirm(
        `Deseja realmente ${actionText} o fornecedor "${supplier.corporateName}"?`
      )
    ) {
      return;
    }

    startTransition(async () => {
      const res = await toggleSupplierActiveAction({
        id: supplier.id,
        active: !supplier.active,
        expectedVersion: supplier.version,
      });

      if (res.status === "success") {
        setSuppliers((prev) =>
          prev.map((s) => (s.id === res.supplier.id ? res.supplier : s))
        );
        setFeedback({
          type: "success",
          message: `Fornecedor "${res.supplier.corporateName}" ${
            res.supplier.active ? "ativado" : "desativado"
          } com sucesso.`,
        });
      } else {
        setFeedback({ type: "error", message: res.message });
      }
    });
  }

  return (
    <div className="suppliers-page">
      <div className="suppliers-breadcrumb">
        {role === "GESTOR" ? "Gestor" : "Comprador"} <span>›</span> Fornecedores
      </div>

      <header className="suppliers-heading">
        <div>
          <h1>Cadastro de Fornecedores</h1>
          <p>
            {role === "GESTOR"
              ? "Gerencie o catálogo de fornecedores parceiros, identificação fiscal e regras de emissão de NF."
              : "Consulte e cadastre fornecedores para os ciclos de compras."}
          </p>
        </div>
        <button
          type="button"
          className="suppliers-primary-btn"
          onClick={handleOpenCreate}
          disabled={isPending}
        >
          + Novo fornecedor
        </button>
      </header>

      {/* Metrics Bar */}
      <section className="suppliers-metrics" aria-label="Métricas de fornecedores">
        <article>
          <strong>{metrics.total}</strong>
          <span>Total cadastrados</span>
        </article>
        <article className="metric-success">
          <strong>{metrics.active}</strong>
          <span>Fornecedores ativos</span>
        </article>
        {metrics.inactive > 0 ? (
          <article className="metric-warning">
            <strong>{metrics.inactive}</strong>
            <span>Inativos</span>
          </article>
        ) : null}
        <article className="metric-info">
          <strong>{metrics.weighing}</strong>
          <span>NF após pesagem</span>
        </article>
        <article className="metric-info">
          <strong>{metrics.special}</strong>
          <span>Regime especial / produtor</span>
        </article>
      </section>

      {/* Feedback Alert */}
      {feedback ? (
        <div
          className={`suppliers-feedback ${
            feedback.type === "success"
              ? "suppliers-feedback--success"
              : "suppliers-feedback--error"
          }`}
          role="alert"
        >
          {feedback.message}
        </div>
      ) : null}

      {/* Search and Filters */}
      <div className="suppliers-filter-bar">
        <div className="suppliers-search-wrap">
          <input
            type="search"
            className="suppliers-search"
            placeholder="Buscar por razão social, nome fantasia, CNPJ/CPF ou contato..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="suppliers-filter-row">
          <div className="suppliers-filter-group" role="group" aria-label="Filtro de situação">
            <button
              type="button"
              className="suppliers-filter-pill"
              aria-pressed={statusFilter === "ALL"}
              onClick={() => setStatusFilter("ALL")}
            >
              Todos ({suppliers.length})
            </button>
            <button
              type="button"
              className="suppliers-filter-pill"
              aria-pressed={statusFilter === "ACTIVE"}
              onClick={() => setStatusFilter("ACTIVE")}
            >
              Ativos ({metrics.active})
            </button>
            <button
              type="button"
              className="suppliers-filter-pill"
              aria-pressed={statusFilter === "INACTIVE"}
              onClick={() => setStatusFilter("INACTIVE")}
            >
              Inativos ({metrics.inactive})
            </button>
          </div>

          <div className="suppliers-rule-filter">
            <label htmlFor="rule-filter" style={{ marginRight: 6, fontSize: "0.78rem", fontWeight: 600 }}>
              Regra de NF:
            </label>
            <select
              id="rule-filter"
              value={ruleFilter}
              onChange={(e) => setRuleFilter(e.target.value as "ALL" | TaxInvoiceRule)}
            >
              <option value="ALL">Todas as regras</option>
              <option value="STANDARD">Emissão normal</option>
              <option value="AFTER_WEIGHING">Após pesagem (banana)</option>
              <option value="SPECIAL_REGIME">Regime especial / produtor</option>
            </select>
          </div>
        </div>
      </div>

      {/* Suppliers Table (Desktop) */}
      <div className="suppliers-table-wrap">
        <table className="suppliers-table">
          <thead>
            <tr>
              <th>Razão Social / Nome Fantasia</th>
              <th>Documento Fiscal</th>
              <th>Regra de Emissão de NF</th>
              <th>Contato</th>
              <th>Situação</th>
              <th style={{ textAlign: "right" }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {filteredSuppliers.length === 0 ? (
              <tr>
                <td colSpan={6} className="suppliers-empty">
                  Nenhum fornecedor encontrado.
                </td>
              </tr>
            ) : (
              filteredSuppliers.map((supplier) => (
                <tr key={supplier.id} data-inactive={!supplier.active}>
                  <td>
                    <div className="suppliers-identity-cell">
                      <span className="suppliers-corporate-name">{supplier.corporateName}</span>
                      {supplier.tradeName ? (
                        <span className="suppliers-trade-name">{supplier.tradeName}</span>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    {supplier.taxId ? (
                      <span className="suppliers-badge suppliers-badge--doc">
                        {formatTaxId(supplier.taxId)}
                        {" (" + (TAX_ID_TYPE_LABELS[supplier.taxIdType] ?? supplier.taxIdType) + ")"}
                      </span>
                    ) : (
                      <span style={{ color: "var(--ink-600)", fontStyle: "italic", fontSize: "0.76rem" }}>
                        Não informado
                      </span>
                    )}
                  </td>
                  <td>
                    <span
                      className={`suppliers-badge ${
                        supplier.taxInvoiceRule === "STANDARD"
                          ? "suppliers-badge--rule-standard"
                          : supplier.taxInvoiceRule === "AFTER_WEIGHING"
                          ? "suppliers-badge--rule-weighing"
                          : "suppliers-badge--rule-special"
                      }`}
                    >
                      {TAX_INVOICE_RULE_LABELS[supplier.taxInvoiceRule] ?? supplier.taxInvoiceRule}
                    </span>
                  </td>
                  <td>
                    {supplier.contactName || supplier.contactPhone ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        {supplier.contactName ? (
                          <span style={{ fontWeight: 600 }}>{supplier.contactName}</span>
                        ) : null}
                        {supplier.contactPhone ? (
                          <span style={{ color: "var(--ink-600)", fontSize: "0.75rem" }}>
                            {formatPhone(supplier.contactPhone)}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <span style={{ color: "var(--ink-600)", fontSize: "0.75rem" }}>—</span>
                    )}
                  </td>
                  <td>
                    <span
                      className={`suppliers-badge ${
                        supplier.active ? "suppliers-badge--active" : "suppliers-badge--inactive"
                      }`}
                    >
                      {supplier.active ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  <td>
                    <div className="suppliers-actions-cell">
                      <Link
                        href={`/${role === "GESTOR" ? "gestor" : "comprador"}/fornecedores/${supplier.id}/faturamento`}
                        className="suppliers-btn-billing"
                        title="Visualizar faturamento e espelho de pedidos do ciclo"
                      >
                        Faturamento
                      </Link>
                      <button
                        type="button"
                        className="suppliers-btn-edit"
                        onClick={() => handleOpenEdit(supplier)}
                        disabled={isPending}
                      >
                        Editar
                      </button>
                      {canToggleStatus ? (
                        <button
                          type="button"
                          className={`suppliers-btn-toggle ${
                            supplier.active
                              ? "suppliers-btn-toggle--deactivate"
                              : "suppliers-btn-toggle--activate"
                          }`}
                          onClick={() => handleToggleStatus(supplier)}
                          disabled={isPending}
                        >
                          {supplier.active ? "Desativar" : "Ativar"}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Suppliers Cards (Mobile) */}
      <div className="suppliers-mobile-cards">
        {filteredSuppliers.length === 0 ? (
          <div className="suppliers-empty">Nenhum fornecedor encontrado.</div>
        ) : (
          filteredSuppliers.map((supplier) => (
            <article key={supplier.id} className="suppliers-card" data-inactive={!supplier.active}>
              <div className="suppliers-card-header">
                <div>
                  <h3 className="suppliers-corporate-name" style={{ margin: "0 0 2px" }}>
                    {supplier.corporateName}
                  </h3>
                  {supplier.tradeName ? (
                    <span className="suppliers-trade-name">{supplier.tradeName}</span>
                  ) : null}
                </div>
                <span
                  className={`suppliers-badge ${
                    supplier.active ? "suppliers-badge--active" : "suppliers-badge--inactive"
                  }`}
                >
                  {supplier.active ? "Ativo" : "Inativo"}
                </span>
              </div>

              <dl className="suppliers-card-meta">
                <div>
                  <dt>Documento</dt>
                  <dd>
                    {supplier.taxId
                      ? `${formatTaxId(supplier.taxId)} (${TAX_ID_TYPE_LABELS[supplier.taxIdType]})`
                      : "Não informado"}
                  </dd>
                </div>
                <div>
                  <dt>Regra NF</dt>
                  <dd>{TAX_INVOICE_RULE_LABELS[supplier.taxInvoiceRule]}</dd>
                </div>
                {supplier.contactName || supplier.contactPhone ? (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <dt>Contato</dt>
                    <dd>
                      {supplier.contactName ? `${supplier.contactName} ` : ""}
                      {supplier.contactPhone ? `(${formatPhone(supplier.contactPhone)})` : ""}
                    </dd>
                  </div>
                ) : null}
              </dl>

              <div className="suppliers-card-actions">
                <Link
                  href={`/${role === "GESTOR" ? "gestor" : "comprador"}/fornecedores/${supplier.id}/faturamento`}
                  className="suppliers-btn-billing"
                >
                  Faturamento
                </Link>
                <button
                  type="button"
                  className="suppliers-btn-edit"
                  onClick={() => handleOpenEdit(supplier)}
                  disabled={isPending}
                >
                  Editar
                </button>
                {canToggleStatus ? (
                  <button
                    type="button"
                    className={`suppliers-btn-toggle ${
                      supplier.active
                        ? "suppliers-btn-toggle--deactivate"
                        : "suppliers-btn-toggle--activate"
                    }`}
                    onClick={() => handleToggleStatus(supplier)}
                    disabled={isPending}
                  >
                    {supplier.active ? "Desativar" : "Ativar"}
                  </button>
                ) : null}
              </div>
            </article>
          ))
        )}
      </div>

      {/* Modal de Criação */}
      {isCreating ? (
        <div
          className="suppliers-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-modal-title"
        >
          <div className="suppliers-modal">
            <header className="suppliers-modal-header">
              <div>
                <h2 id="create-modal-title">Novo Fornecedor</h2>
                <p>Preencha os dados do fornecedor parceiro.</p>
              </div>
              <button
                type="button"
                className="suppliers-modal-close"
                onClick={() => setIsCreating(false)}
                aria-label="Fechar"
              >
                ×
              </button>
            </header>

            <form onSubmit={handleCreateSubmit}>
              <div className="suppliers-modal-body">
                {formError ? (
                  <div className="suppliers-feedback suppliers-feedback--error" role="alert">
                    {formError}
                  </div>
                ) : null}

                <div className="suppliers-form-group suppliers-form-group--full">
                  <label htmlFor="create-corporateName">
                    Razão Social <span className="required">*</span>
                  </label>
                  <input
                    id="create-corporateName"
                    type="text"
                    required
                    placeholder="Ex: Comercial Hortifruti MultiShow Ltda"
                    value={createForm.corporateName}
                    onChange={(e) =>
                      setCreateForm((prev) => ({ ...prev, corporateName: e.target.value }))
                    }
                  />
                </div>

                <div className="suppliers-form-grid">
                  <div className="suppliers-form-group">
                    <label htmlFor="create-tradeName">Nome Fantasia</label>
                    <input
                      id="create-tradeName"
                      type="text"
                      placeholder="Ex: Multi Hortifruti"
                      value={createForm.tradeName}
                      onChange={(e) =>
                        setCreateForm((prev) => ({ ...prev, tradeName: e.target.value }))
                      }
                    />
                  </div>

                  <div className="suppliers-form-group">
                    <label htmlFor="create-taxId">CNPJ ou CPF</label>
                    <input
                      id="create-taxId"
                      type="text"
                      placeholder="00.000.000/0000-00 ou 000.000.000-00"
                      value={createForm.taxId}
                      onChange={(e) =>
                        setCreateForm((prev) => ({
                          ...prev,
                          taxId: maskTaxIdInput(e.target.value),
                        }))
                      }
                    />
                    <span className="suppliers-form-hint">Opcional. Detecta CNPJ ou CPF automaticamente.</span>
                  </div>
                </div>

                <div className="suppliers-form-group suppliers-form-group--full">
                  <label htmlFor="create-taxInvoiceRule">Regra de Emissão de Nota Fiscal</label>
                  <select
                    id="create-taxInvoiceRule"
                    value={createForm.taxInvoiceRule}
                    onChange={(e) =>
                      setCreateForm((prev) => ({
                        ...prev,
                        taxInvoiceRule: e.target.value as TaxInvoiceRule,
                      }))
                    }
                  >
                    <option value="STANDARD">Emissão normal (NF padrão antes do despacho)</option>
                    <option value="AFTER_WEIGHING">
                      Após pesagem (banana e produtos faturados pós-conferência)
                    </option>
                    <option value="SPECIAL_REGIME">
                      Regime especial / produtor rural (sem NF imediata ou contranota)
                    </option>
                  </select>
                </div>

                <div className="suppliers-form-grid">
                  <div className="suppliers-form-group">
                    <label htmlFor="create-contactName">Nome do Contato</label>
                    <input
                      id="create-contactName"
                      type="text"
                      placeholder="Ex: João Silva"
                      value={createForm.contactName}
                      onChange={(e) =>
                        setCreateForm((prev) => ({ ...prev, contactName: e.target.value }))
                      }
                    />
                  </div>

                  <div className="suppliers-form-group">
                    <label htmlFor="create-contactPhone">Telefone / WhatsApp</label>
                    <input
                      id="create-contactPhone"
                      type="text"
                      placeholder="(27) 99999-9999"
                      value={createForm.contactPhone}
                      onChange={(e) =>
                        setCreateForm((prev) => ({
                          ...prev,
                          contactPhone: maskPhoneInput(e.target.value),
                        }))
                      }
                    />
                  </div>
                </div>

                <div className="suppliers-form-group suppliers-form-group--full">
                  <label htmlFor="create-notes">Observações</label>
                  <textarea
                    id="create-notes"
                    placeholder="Instruções de recebimento, chave PIX, prazos acordados, etc."
                    value={createForm.notes}
                    onChange={(e) =>
                      setCreateForm((prev) => ({ ...prev, notes: e.target.value }))
                    }
                  />
                </div>
              </div>

              <footer className="suppliers-modal-footer">
                <button
                  type="button"
                  className="suppliers-secondary-btn"
                  onClick={() => setIsCreating(false)}
                  disabled={isPending}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="suppliers-primary-btn"
                  disabled={isPending}
                >
                  {isPending ? "Cadastrando..." : "Cadastrar fornecedor"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      ) : null}

      {/* Modal de Edição */}
      {editingSupplier ? (
        <div
          className="suppliers-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-modal-title"
        >
          <div className="suppliers-modal">
            <header className="suppliers-modal-header">
              <div>
                <h2 id="edit-modal-title">Editar Fornecedor</h2>
                <p>Atualize os dados e regras fiscais do fornecedor.</p>
              </div>
              <button
                type="button"
                className="suppliers-modal-close"
                onClick={() => setEditingSupplier(null)}
                aria-label="Fechar"
              >
                ×
              </button>
            </header>

            <form onSubmit={handleEditSubmit}>
              <div className="suppliers-modal-body">
                {formError ? (
                  <div className="suppliers-feedback suppliers-feedback--error" role="alert">
                    {formError}
                  </div>
                ) : null}

                <div className="suppliers-form-group suppliers-form-group--full">
                  <label htmlFor="edit-corporateName">
                    Razão Social <span className="required">*</span>
                  </label>
                  <input
                    id="edit-corporateName"
                    type="text"
                    required
                    value={editForm.corporateName}
                    onChange={(e) =>
                      setEditForm((prev) => ({ ...prev, corporateName: e.target.value }))
                    }
                  />
                </div>

                <div className="suppliers-form-grid">
                  <div className="suppliers-form-group">
                    <label htmlFor="edit-tradeName">Nome Fantasia</label>
                    <input
                      id="edit-tradeName"
                      type="text"
                      value={editForm.tradeName}
                      onChange={(e) =>
                        setEditForm((prev) => ({ ...prev, tradeName: e.target.value }))
                      }
                    />
                  </div>

                  <div className="suppliers-form-group">
                    <label htmlFor="edit-taxId">CNPJ ou CPF</label>
                    <input
                      id="edit-taxId"
                      type="text"
                      value={editForm.taxId}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          taxId: maskTaxIdInput(e.target.value),
                        }))
                      }
                    />
                  </div>
                </div>

                <div className="suppliers-form-group suppliers-form-group--full">
                  <label htmlFor="edit-taxInvoiceRule">Regra de Emissão de Nota Fiscal</label>
                  <select
                    id="edit-taxInvoiceRule"
                    value={editForm.taxInvoiceRule}
                    onChange={(e) =>
                      setEditForm((prev) => ({
                        ...prev,
                        taxInvoiceRule: e.target.value as TaxInvoiceRule,
                      }))
                    }
                  >
                    <option value="STANDARD">Emissão normal (NF padrão antes do despacho)</option>
                    <option value="AFTER_WEIGHING">
                      Após pesagem (banana e produtos faturados pós-conferência)
                    </option>
                    <option value="SPECIAL_REGIME">
                      Regime especial / produtor rural (sem NF imediata ou contranota)
                    </option>
                  </select>
                </div>

                <div className="suppliers-form-grid">
                  <div className="suppliers-form-group">
                    <label htmlFor="edit-contactName">Nome do Contato</label>
                    <input
                      id="edit-contactName"
                      type="text"
                      value={editForm.contactName}
                      onChange={(e) =>
                        setEditForm((prev) => ({ ...prev, contactName: e.target.value }))
                      }
                    />
                  </div>

                  <div className="suppliers-form-group">
                    <label htmlFor="edit-contactPhone">Telefone / WhatsApp</label>
                    <input
                      id="edit-contactPhone"
                      type="text"
                      value={editForm.contactPhone}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          contactPhone: maskPhoneInput(e.target.value),
                        }))
                      }
                    />
                  </div>
                </div>

                <div className="suppliers-form-group suppliers-form-group--full">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <label style={{ margin: 0, fontWeight: 700, fontSize: "0.85rem" }}>
                      Produtos Vinculados ({linkedProducts.length})
                    </label>
                    <Link
                      href={`/${role === "GESTOR" ? "gestor" : "comprador"}/fornecedores/${editingSupplier.id}/faturamento`}
                      className="suppliers-btn-billing"
                      style={{ fontSize: "0.75rem", padding: "4px 8px" }}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Espelho de Faturamento do Ciclo ↗
                    </Link>
                  </div>
                  {isLoadingProducts ? (
                    <div style={{ fontSize: "0.8rem", color: "var(--ink-600)", padding: "8px 0" }}>
                      Carregando produtos vinculados...
                    </div>
                  ) : linkedProducts.length === 0 ? (
                    <div style={{ fontSize: "0.8rem", color: "var(--ink-600)", padding: "8px 0", fontStyle: "italic" }}>
                      Nenhum produto vinculado a este fornecedor. A vinculação é configurada no Cadastro de Produtos.
                    </div>
                  ) : (
                    <div
                      style={{
                        maxHeight: "150px",
                        overflowY: "auto",
                        border: "1px solid var(--border)",
                        borderRadius: "6px",
                        background: "#fafbfc",
                      }}
                    >
                      <table style={{ width: "100%", fontSize: "0.78rem", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ background: "#edf1f4", textAlign: "left" }}>
                            <th style={{ padding: "6px 8px" }}>Cód. ERP</th>
                            <th style={{ padding: "6px 8px" }}>Produto</th>
                            <th style={{ padding: "6px 8px", textAlign: "center" }}>Tipo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {linkedProducts.map((p) => (
                            <tr key={p.id} style={{ borderTop: "1px solid #edf1f4" }}>
                              <td style={{ padding: "6px 8px", fontWeight: 700 }}>{p.erpCode}</td>
                              <td style={{ padding: "6px 8px" }}>{p.productName}</td>
                              <td style={{ padding: "6px 8px", textAlign: "center" }}>
                                {p.isExclusive ? (
                                  <span
                                    style={{
                                      display: "inline-block",
                                      padding: "2px 6px",
                                      borderRadius: "999px",
                                      fontSize: "0.7rem",
                                      fontWeight: 700,
                                      background: "#fef3c7",
                                      color: "#92400e",
                                    }}
                                  >
                                    Exclusivo
                                  </span>
                                ) : p.isPrimary ? (
                                  <span
                                    style={{
                                      display: "inline-block",
                                      padding: "2px 6px",
                                      borderRadius: "999px",
                                      fontSize: "0.7rem",
                                      fontWeight: 700,
                                      background: "#e0f2fe",
                                      color: "#0369a1",
                                    }}
                                  >
                                    Principal
                                  </span>
                                ) : (
                                  <span style={{ color: "var(--ink-600)", fontSize: "0.7rem" }}>
                                    Alternativo
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="suppliers-form-group suppliers-form-group--full">
                  <label htmlFor="edit-notes">Observações</label>
                  <textarea
                    id="edit-notes"
                    value={editForm.notes}
                    onChange={(e) =>
                      setEditForm((prev) => ({ ...prev, notes: e.target.value }))
                    }
                  />
                </div>
              </div>

              <footer className="suppliers-modal-footer">
                <button
                  type="button"
                  className="suppliers-secondary-btn"
                  onClick={() => setEditingSupplier(null)}
                  disabled={isPending}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="suppliers-primary-btn"
                  disabled={isPending}
                >
                  {isPending ? "Salvando..." : "Salvar alterações"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
