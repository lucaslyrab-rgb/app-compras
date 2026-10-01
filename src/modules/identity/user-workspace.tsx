"use client";

import { useMemo, useState, useTransition } from "react";
import type {
  ActiveStoreOption,
  ManagedUser,
} from "./repository";
import {
  PERMISSION_GROUPS,
  ROLE_DEFAULT_PERMISSIONS,
  validatePassword,
  type Permission,
  type Role,
} from "./domain";
import {
  createUserAction,
  updateUserAction,
  toggleUserActiveAction,
  resetUserPasswordAction,
} from "./actions";

export function UserWorkspace({
  initialUsers,
  stores,
  currentUserId,
}: {
  initialUsers: ManagedUser[];
  stores: ActiveStoreOption[];
  currentUserId: string;
}) {
  const [users, setUsers] = useState<ManagedUser[]>(initialUsers);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");

  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  // Modals state
  const [isCreating, setIsCreating] = useState(false);
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [resettingUser, setResettingUser] = useState<ManagedUser | null>(null);

  // Form state for creation
  const [createForm, setCreateForm] = useState<{
    name: string;
    email: string;
    role: Role;
    storeId: string;
    permissions: Permission[];
    password: string;
    passwordConfirmation: string;
  }>({
    name: "",
    email: "",
    role: "LOJA",
    storeId: stores[0]?.id ?? "",
    permissions: [...ROLE_DEFAULT_PERMISSIONS.LOJA],
    password: "",
    passwordConfirmation: "",
  });

  // Form state for edition
  const [editForm, setEditForm] = useState<{
    name: string;
    email: string;
    role: Role;
    storeId: string;
    permissions: Permission[];
    active: boolean;
  }>({
    name: "",
    email: "",
    role: "LOJA",
    storeId: "",
    permissions: [],
    active: true,
  });

  // Form state for reset password
  const [resetForm, setResetForm] = useState({
    newPassword: "",
    passwordConfirmation: "",
  });

  // Filtered users
  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      const matchesSearch = !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
      const matchesStatus =
        statusFilter === "ALL" ||
        (statusFilter === "ACTIVE" && u.active) ||
        (statusFilter === "INACTIVE" && !u.active);
      return matchesSearch && matchesStatus;
    });
  }, [users, search, statusFilter]);

  // Metrics
  const metrics = useMemo(() => {
    const total = users.length;
    const active = users.filter((u) => u.active).length;
    const inactive = total - active;
    const managers = users.filter((u) => u.active && u.permissions.includes("gestor:usuarios")).length;
    return { total, active, inactive, managers };
  }, [users]);

  // Helpers for Creation
  function handleOpenCreate() {
    setFeedback(null);
    setCreateForm({
      name: "",
      email: "",
      role: "LOJA",
      storeId: stores[0]?.id ?? "",
      permissions: [...ROLE_DEFAULT_PERMISSIONS.LOJA],
      password: "",
      passwordConfirmation: "",
    });
    setIsCreating(true);
  }

  function handleCreateRoleChange(newRole: Role) {
    const defaultPerms = [...ROLE_DEFAULT_PERMISSIONS[newRole]];
    setCreateForm((prev) => ({
      ...prev,
      role: newRole,
      permissions: defaultPerms,
      storeId: newRole === "LOJA" ? (prev.storeId || (stores[0]?.id ?? "")) : "",
    }));
  }

  function handleCreatePermissionToggle(perm: Permission) {
    setCreateForm((prev) => {
      const exists = prev.permissions.includes(perm);
      const updated = exists ? prev.permissions.filter((p) => p !== perm) : [...prev.permissions, perm];
      const hasStorePerm = updated.includes("pedidos:criar") || updated.includes("pedidos:historico");
      return {
        ...prev,
        permissions: updated,
        storeId: hasStorePerm ? (prev.storeId || (stores[0]?.id ?? "")) : "",
      };
    });
  }

  function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);

    const hasStorePerm = createForm.permissions.includes("pedidos:criar") || createForm.permissions.includes("pedidos:historico");
    if (hasStorePerm && !createForm.storeId) {
      setFeedback({ type: "error", message: "Selecione uma loja para as permissões de pedidos." });
      return;
    }
    if (createForm.password !== createForm.passwordConfirmation) {
      setFeedback({ type: "error", message: "As senhas não coincidem." });
      return;
    }
    const pwdValidation = validatePassword(createForm.password);
    if (!pwdValidation.valid) {
      setFeedback({ type: "error", message: pwdValidation.reason ?? "Senha inválida." });
      return;
    }

    startTransition(async () => {
      const res = await createUserAction({
        name: createForm.name,
        email: createForm.email,
        role: createForm.role,
        storeId: hasStorePerm ? createForm.storeId : null,
        permissions: createForm.permissions,
        password: createForm.password,
        passwordConfirmation: createForm.passwordConfirmation,
      });

      if (res.status === "success") {
        setUsers((prev) => [...prev, res.user].sort((a, b) => a.name.localeCompare(b.name)));
        setIsCreating(false);
        setFeedback({ type: "success", message: `Usuário ${res.user.name} criado com sucesso!` });
      } else {
        setFeedback({ type: "error", message: res.message });
      }
    });
  }

  // Helpers for Edition
  function handleOpenEdit(user: ManagedUser) {
    setFeedback(null);
    setEditingUser(user);
    setEditForm({
      name: user.name,
      email: user.email,
      role: user.role,
      storeId: user.storeId ?? (stores[0]?.id ?? ""),
      permissions: [...user.permissions],
      active: user.active,
    });
  }

  function handleEditRoleChange(newRole: Role) {
    const defaultPerms = [...ROLE_DEFAULT_PERMISSIONS[newRole]];
    setEditForm((prev) => ({
      ...prev,
      role: newRole,
      permissions: defaultPerms,
      storeId: newRole === "LOJA" ? (prev.storeId || (stores[0]?.id ?? "")) : "",
    }));
  }

  function handleEditPermissionToggle(perm: Permission) {
    setEditForm((prev) => {
      const exists = prev.permissions.includes(perm);
      const updated = exists ? prev.permissions.filter((p) => p !== perm) : [...prev.permissions, perm];
      const hasStorePerm = updated.includes("pedidos:criar") || updated.includes("pedidos:historico");
      return {
        ...prev,
        permissions: updated,
        storeId: hasStorePerm ? (prev.storeId || (stores[0]?.id ?? "")) : "",
      };
    });
  }

  function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingUser) return;
    setFeedback(null);

    const hasStorePerm = editForm.permissions.includes("pedidos:criar") || editForm.permissions.includes("pedidos:historico");
    if (hasStorePerm && !editForm.storeId) {
      setFeedback({ type: "error", message: "Selecione uma loja para as permissões de pedidos." });
      return;
    }

    startTransition(async () => {
      const res = await updateUserAction({
        id: editingUser.id,
        name: editForm.name,
        email: editForm.email,
        role: editForm.role,
        storeId: hasStorePerm ? editForm.storeId : null,
        permissions: editForm.permissions,
        active: editForm.active,
        expectedUpdatedAt: editingUser.updatedAt,
      });

      if (res.status === "success") {
        setUsers((prev) => prev.map((u) => (u.id === res.user.id ? res.user : u)));
        setEditingUser(null);
        setFeedback({ type: "success", message: `Usuário ${res.user.name} atualizado com sucesso!` });
      } else if (res.status === "conflict") {
        setUsers(res.freshUsers);
        setEditingUser(null);
        setFeedback({ type: "error", message: res.message });
      } else {
        setFeedback({ type: "error", message: res.message });
      }
    });
  }

  // Toggle active
  function handleToggleActive(user: ManagedUser) {
    setFeedback(null);
    const newActive = !user.active;
    const actionLabel = newActive ? "ativar" : "inativar";

    if (!confirm(`Deseja realmente ${actionLabel} o usuário ${user.name}?`)) {
      return;
    }

    startTransition(async () => {
      const res = await toggleUserActiveAction({
        id: user.id,
        active: newActive,
        expectedUpdatedAt: user.updatedAt,
      });

      if (res.status === "success") {
        setUsers((prev) => prev.map((u) => (u.id === res.user.id ? res.user : u)));
        setFeedback({
          type: "success",
          message: `Usuário ${res.user.name} ${newActive ? "ativado" : "inativado"} com sucesso.`,
        });
      } else if (res.status === "conflict") {
        setUsers(res.freshUsers);
        setFeedback({ type: "error", message: res.message });
      } else {
        setFeedback({ type: "error", message: res.message });
      }
    });
  }

  // Reset password
  function handleOpenReset(user: ManagedUser) {
    setFeedback(null);
    setResettingUser(user);
    setResetForm({ newPassword: "", passwordConfirmation: "" });
  }

  function submitResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!resettingUser) return;
    setFeedback(null);

    if (resetForm.newPassword !== resetForm.passwordConfirmation) {
      setFeedback({ type: "error", message: "As senhas não coincidem." });
      return;
    }
    const pwdValidation = validatePassword(resetForm.newPassword);
    if (!pwdValidation.valid) {
      setFeedback({ type: "error", message: pwdValidation.reason ?? "Senha inválida." });
      return;
    }

    startTransition(async () => {
      const res = await resetUserPasswordAction({
        targetUserId: resettingUser.id,
        newPassword: resetForm.newPassword,
        passwordConfirmation: resetForm.passwordConfirmation,
        expectedUpdatedAt: resettingUser.updatedAt,
      });

      if (res.status === "success") {
        setResettingUser(null);
        setFeedback({
          type: "success",
          message: `Senha de ${resettingUser.name} redefinida com sucesso. Sessões anteriores foram revogadas.`,
        });
      } else if (res.status === "conflict") {
        setResettingUser(null);
        setUsers(res.freshUsers);
        setFeedback({ type: "error", message: res.message });
      } else {
        setFeedback({ type: "error", message: res.message });
      }
    });
  }

  // Format permission summary
  function formatPermissionSummary(perms: Permission[]) {
    if (perms.length === 0) return "Nenhuma permissão";
    if (perms.length === 8) return "Acesso total (8)";
    return `${perms.length} permiss${perms.length > 1 ? "ões" : "ão"}`;
  }

  return (
    <main className="manager-page">
      <div className="manager-breadcrumb">
        Gestor <span>›</span> Usuários
      </div>

      <header className="manager-heading">
        <div>
          <h1>Gestão de Usuários</h1>
          <p>Gerencie o acesso, perfis e permissões granulares dos operadores e gestores do sistema.</p>
        </div>
        <button
          type="button"
          className="manager-primary"
          onClick={handleOpenCreate}
          disabled={isPending}
        >
          + Novo usuário
        </button>
      </header>

      {/* Metrics */}
      <section className="manager-metrics" aria-label="Métricas de usuários">
        <article className="metric-info">
          <strong>{metrics.total}</strong>
          <span>Total de usuários</span>
        </article>
        <article className="metric-success">
          <strong>{metrics.active}</strong>
          <span>Usuários ativos</span>
        </article>
        <article className={metrics.inactive > 0 ? "metric-warning" : ""}>
          <strong>{metrics.inactive}</strong>
          <span>Inativos</span>
        </article>
        <article className="metric-info">
          <strong>{metrics.managers}</strong>
          <span>Gestores com acesso</span>
        </article>
      </section>

      {/* Feedback Alert */}
      {feedback ? (
        <div
          className={`manager-feedback ${feedback.type === "success" ? "manager-feedback--success" : "manager-feedback--error"}`}
          role="alert"
          style={{ marginBottom: 14 }}
        >
          {feedback.message}
        </div>
      ) : null}

      {/* Filters */}
      <div className="manager-filter-row" style={{ marginBottom: 14 }}>
        <input
          type="search"
          className="manager-search"
          placeholder="Pesquisar por nome ou e-mail..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 380, fontSize: "16px" }}
        />
        <div className="manager-filters">
          <button
            type="button"
            aria-pressed={statusFilter === "ALL"}
            onClick={() => setStatusFilter("ALL")}
          >
            Todos ({metrics.total})
          </button>
          <button
            type="button"
            aria-pressed={statusFilter === "ACTIVE"}
            onClick={() => setStatusFilter("ACTIVE")}
          >
            Ativos ({metrics.active})
          </button>
          <button
            type="button"
            aria-pressed={statusFilter === "INACTIVE"}
            onClick={() => setStatusFilter("INACTIVE")}
          >
            Inativos ({metrics.inactive})
          </button>
        </div>
      </div>

      {/* Desktop Table */}
      <div className="manager-table-wrap">
        <table className="manager-table" aria-label="Lista de usuários cadastrados">
          <thead>
            <tr>
              <th>Nome</th>
              <th>E-mail</th>
              <th>Perfil Base</th>
              <th>Loja</th>
              <th>Permissões</th>
              <th>Status</th>
              <th style={{ textAlign: "right" }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={7} className="manager-empty">
                  Nenhum usuário encontrado com os filtros selecionados.
                </td>
              </tr>
            ) : (
              filteredUsers.map((u) => {
                const isSelf = u.id === currentUserId;
                return (
                  <tr key={u.id} data-inactive={!u.active}>
                    <td>
                      <div className="manager-product-cell">
                        <span className="manager-placeholder manager-placeholder--small" aria-hidden="true">
                          {u.name.charAt(0).toUpperCase()}
                        </span>
                        <div>
                          <strong>{u.name}</strong>
                          {isSelf ? <small style={{ color: "var(--brand-700)", display: "block" }}> (Você)</small> : null}
                        </div>
                      </div>
                    </td>
                    <td>{u.email}</td>
                    <td>
                      <span className={`manager-role-badge manager-role-badge--${u.role.toLowerCase()}`}>
                        {u.role}
                      </span>
                    </td>
                    <td>{u.storeName ? u.storeName : <span style={{ color: "var(--ink-600)" }}>—</span>}</td>
                    <td>
                      <span title={u.permissions.join(", ")}>
                        {formatPermissionSummary(u.permissions)}
                      </span>
                    </td>
                    <td>
                      <span className={`manager-badge ${u.active ? "manager-badge--active" : "manager-badge--inactive"}`}>
                        {u.active ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div className="manager-row-actions" style={{ justifyContent: "flex-end" }}>
                        <button
                          type="button"
                          className="manager-secondary"
                          style={{ minHeight: 32, padding: "4px 8px" }}
                          onClick={() => handleOpenEdit(u)}
                          disabled={isPending}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="manager-secondary"
                          style={{ minHeight: 32, padding: "4px 8px" }}
                          onClick={() => handleOpenReset(u)}
                          disabled={isPending}
                          title="Resetar senha deste usuário"
                        >
                          Resetar senha
                        </button>
                        <button
                          type="button"
                          className="manager-secondary"
                          style={{
                            minHeight: 32,
                            padding: "4px 8px",
                            color: u.active ? "#9c1721" : "#07683a",
                          }}
                          onClick={() => handleToggleActive(u)}
                          disabled={isPending}
                        >
                          {u.active ? "Inativar" : "Ativar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="manager-mobile-cards">
        {filteredUsers.length === 0 ? (
          <div className="manager-empty">Nenhum usuário encontrado.</div>
        ) : (
          filteredUsers.map((u) => {
            const isSelf = u.id === currentUserId;
            return (
              <article key={u.id} className="manager-mobile-card">
                <header>
                  <div>
                    <h2>
                      {u.name} {isSelf ? <small style={{ color: "var(--brand-700)" }}>(Você)</small> : null}
                    </h2>
                    <p>{u.email}</p>
                  </div>
                  <span className={`manager-badge ${u.active ? "manager-badge--active" : "manager-badge--inactive"}`}>
                    {u.active ? "Ativo" : "Inativo"}
                  </span>
                </header>

                <dl>
                  <div>
                    <dt>Perfil Base</dt>
                    <dd>
                      <span className={`manager-role-badge manager-role-badge--${u.role.toLowerCase()}`}>
                        {u.role}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>Loja</dt>
                    <dd>{u.storeName ?? "—"}</dd>
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <dt>Permissões</dt>
                    <dd style={{ fontSize: ".76rem", fontWeight: "normal" }}>
                      {formatPermissionSummary(u.permissions)} ({u.permissions.join(", ")})
                    </dd>
                  </div>
                </dl>

                <div className="manager-card-actions" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <button
                    type="button"
                    className="manager-secondary"
                    style={{ flex: "1 1 calc(50% - 3px)", minHeight: 40 }}
                    onClick={() => handleOpenEdit(u)}
                    disabled={isPending}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="manager-secondary"
                    style={{ flex: "1 1 calc(50% - 3px)", minHeight: 40 }}
                    onClick={() => handleOpenReset(u)}
                    disabled={isPending}
                  >
                    Resetar Senha
                  </button>
                  <button
                    type="button"
                    className="manager-secondary"
                    style={{
                      width: "100%",
                      minHeight: 40,
                      color: u.active ? "#9c1721" : "#07683a",
                    }}
                    onClick={() => handleToggleActive(u)}
                    disabled={isPending}
                  >
                    {u.active ? "Inativar Usuário" : "Ativar Usuário"}
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>

      {/* MODAL: Criar Usuário */}
      {isCreating ? (
        <div className="manager-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="create-title">
          <div className="manager-modal">
            <header className="manager-modal-header">
              <div>
                <h2 id="create-title">Novo Usuário</h2>
                <p>Cadastre um novo operador ou gestor com permissões granulares.</p>
              </div>
              <button
                type="button"
                className="manager-modal-close"
                onClick={() => setIsCreating(false)}
                aria-label="Fechar"
              >
                ×
              </button>
            </header>

            <form onSubmit={submitCreate} className="manager-form">
              <label>
                Nome completo
                <input
                  type="text"
                  required
                  placeholder="Ex: Maria Silva"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  style={{ fontSize: "16px" }}
                />
              </label>

              <label>
                E-mail (Login do sistema)
                <input
                  type="email"
                  required
                  placeholder="exemplo@muitomaisatacado.com"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                  style={{ fontSize: "16px" }}
                />
                <span className="manager-field-hint">O e-mail será normalizado em minúsculas e será o login de acesso.</span>
              </label>

              <div className="manager-form-grid">
                <label>
                  Perfil Base (Template)
                  <select
                    value={createForm.role}
                    onChange={(e) => handleCreateRoleChange(e.target.value as Role)}
                    style={{ minHeight: 44, padding: "8px 12px", borderRadius: 7, border: "1px solid #b7c3cc", fontSize: "16px" }}
                  >
                    <option value="LOJA">LOJA</option>
                    <option value="COMPRADOR">COMPRADOR</option>
                    <option value="GESTOR">GESTOR</option>
                  </select>
                </label>

                <label>
                  Loja Vinculada
                  <select
                    value={createForm.storeId}
                    onChange={(e) => setCreateForm({ ...createForm, storeId: e.target.value })}
                    disabled={!createForm.permissions.includes("pedidos:criar") && !createForm.permissions.includes("pedidos:historico")}
                    style={{ minHeight: 44, padding: "8px 12px", borderRadius: 7, border: "1px solid #b7c3cc", fontSize: "16px" }}
                  >
                    <option value="">Selecione uma loja...</option>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* Grouped permissions */}
              <fieldset className="manager-permissions-fieldset">
                <legend>Permissões Granulares</legend>
                {PERMISSION_GROUPS.map((g) => (
                  <div key={g.group} className="manager-permissions-group">
                    <h4>{g.group}</h4>
                    <div className="manager-permissions-grid">
                      {g.permissions.map((p) => {
                        const checked = createForm.permissions.includes(p.id as Permission);
                        return (
                          <label key={p.id} className="manager-check" style={{ fontSize: ".78rem" }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => handleCreatePermissionToggle(p.id as Permission)}
                            />
                            {p.label}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </fieldset>

              <div className="manager-form-grid">
                <label>
                  Senha Inicial
                  <input
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={createForm.password}
                    onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                    style={{ fontSize: "16px" }}
                  />
                </label>
                <label>
                  Confirmar Senha
                  <input
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={createForm.passwordConfirmation}
                    onChange={(e) => setCreateForm({ ...createForm, passwordConfirmation: e.target.value })}
                    style={{ fontSize: "16px" }}
                  />
                </label>
              </div>
              <span className="manager-field-hint">
                A senha deve ter pelo menos 8 caracteres e conter pelo menos uma letra e um número.
              </span>

              <div className="manager-form-actions" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="manager-secondary"
                  onClick={() => setIsCreating(false)}
                  disabled={isPending}
                >
                  Cancelar
                </button>
                <button type="submit" className="manager-primary" disabled={isPending}>
                  {isPending ? "Cadastrando…" : "Salvar Usuário"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* MODAL: Editar Usuário */}
      {editingUser ? (
        <div className="manager-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="edit-title">
          <div className="manager-modal">
            <header className="manager-modal-header">
              <div>
                <h2 id="edit-title">Editar Usuário: {editingUser.name}</h2>
                <p>Altere dados cadastrais, perfil base e permissões.</p>
              </div>
              <button
                type="button"
                className="manager-modal-close"
                onClick={() => setEditingUser(null)}
                aria-label="Fechar"
              >
                ×
              </button>
            </header>

            <form onSubmit={submitEdit} className="manager-form">
              <label>
                Nome completo
                <input
                  type="text"
                  required
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  style={{ fontSize: "16px" }}
                />
              </label>

              <label>
                E-mail (Login)
                <input
                  type="email"
                  required
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  style={{ fontSize: "16px" }}
                />
              </label>

              <div className="manager-form-grid">
                <label>
                  Perfil Base (Template)
                  <select
                    value={editForm.role}
                    onChange={(e) => handleEditRoleChange(e.target.value as Role)}
                    style={{ minHeight: 44, padding: "8px 12px", borderRadius: 7, border: "1px solid #b7c3cc", fontSize: "16px" }}
                  >
                    <option value="LOJA">LOJA</option>
                    <option value="COMPRADOR">COMPRADOR</option>
                    <option value="GESTOR">GESTOR</option>
                  </select>
                </label>

                <label>
                  Loja Vinculada
                  <select
                    value={editForm.storeId}
                    onChange={(e) => setEditForm({ ...editForm, storeId: e.target.value })}
                    disabled={!editForm.permissions.includes("pedidos:criar") && !editForm.permissions.includes("pedidos:historico")}
                    style={{ minHeight: 44, padding: "8px 12px", borderRadius: 7, border: "1px solid #b7c3cc", fontSize: "16px" }}
                  >
                    <option value="">Selecione uma loja...</option>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* Grouped permissions */}
              <fieldset className="manager-permissions-fieldset">
                <legend>Permissões Granulares</legend>
                {PERMISSION_GROUPS.map((g) => (
                  <div key={g.group} className="manager-permissions-group">
                    <h4>{g.group}</h4>
                    <div className="manager-permissions-grid">
                      {g.permissions.map((p) => {
                        const checked = editForm.permissions.includes(p.id as Permission);
                        return (
                          <label key={p.id} className="manager-check" style={{ fontSize: ".78rem" }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => handleEditPermissionToggle(p.id as Permission)}
                            />
                            {p.label}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </fieldset>

              <label className="manager-check" style={{ marginTop: 6, fontSize: ".84rem", fontWeight: "bold" }}>
                <input
                  type="checkbox"
                  checked={editForm.active}
                  onChange={(e) => setEditForm({ ...editForm, active: e.target.checked })}
                />
                Usuário Ativo (desmarque para inativar o acesso)
              </label>

              <div className="manager-form-actions" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="manager-secondary"
                  onClick={() => setEditingUser(null)}
                  disabled={isPending}
                >
                  Cancelar
                </button>
                <button type="submit" className="manager-primary" disabled={isPending}>
                  {isPending ? "Salvando…" : "Salvar Alterações"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* MODAL: Resetar Senha */}
      {resettingUser ? (
        <div className="manager-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="reset-title">
          <div className="manager-modal" style={{ maxWidth: 480 }}>
            <header className="manager-modal-header">
              <div>
                <h2 id="reset-title">Resetar Senha</h2>
                <p>
                  Definindo nova senha para <strong>{resettingUser.name}</strong> ({resettingUser.email}).
                </p>
              </div>
              <button
                type="button"
                className="manager-modal-close"
                onClick={() => setResettingUser(null)}
                aria-label="Fechar"
              >
                ×
              </button>
            </header>

            <form onSubmit={submitResetPassword} className="manager-form">
              <div className="manager-confirmation" style={{ fontSize: ".78rem" }}>
                ⚠️ Todas as sessões existentes deste usuário serão revogadas imediatamente após a redefinição.
              </div>

              <label>
                Nova Senha
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="Mínimo 8 caracteres (letras e números)"
                  value={resetForm.newPassword}
                  onChange={(e) => setResetForm({ ...resetForm, newPassword: e.target.value })}
                  style={{ fontSize: "16px" }}
                />
              </label>

              <label>
                Confirmar Nova Senha
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="Repita a nova senha"
                  value={resetForm.passwordConfirmation}
                  onChange={(e) => setResetForm({ ...resetForm, passwordConfirmation: e.target.value })}
                  style={{ fontSize: "16px" }}
                />
              </label>
              <span className="manager-field-hint">
                A senha deve ter pelo menos 8 caracteres e conter pelo menos uma letra e um número.
              </span>

              <div className="manager-form-actions" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="manager-secondary"
                  onClick={() => setResettingUser(null)}
                  disabled={isPending}
                >
                  Cancelar
                </button>
                <button type="submit" className="manager-primary" disabled={isPending}>
                  {isPending ? "Redefinindo…" : "Confirmar Nova Senha"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  );
}
