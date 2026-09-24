"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { savePurchaseCostAction } from "./costs/actions";
import {
  filterPurchaseCostProducts,
  formatCostInput,
  formatCurrency,
  isCostChanged,
  storeQuantity,
  validatePurchaseCost,
  type CostFilter,
  type PurchaseCostProduct,
  type PurchaseCostsData,
} from "./costs/domain";
import { shortStoreName, storeColor } from "./domain";

type SaveStatus = "idle" | "saving" | "saved" | "error";
type EditableRow = {
  costInput: string;
  costIsUnit: boolean;
  purchased: boolean;
  version: number;
  status: SaveStatus;
  message: string;
  dirty: boolean;
  mutation: number;
  savedMutation: number;
};

const quantityFormat = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 2,
});

function quantity(value: string | null) {
  return value === null ? "—" : quantityFormat.format(Number(value));
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "long",
  }).format(new Date(`${value}T12:00:00Z`));
}

function storeLetter(slug: string, name: string) {
  return (
    { "ponta-da-fruta": "P", balneario: "B", "santa-monica": "S" } as Record<
      string,
      string
    >
  )[slug] ?? shortStoreName(name).slice(0, 1).toLocaleUpperCase("pt-BR");
}

function Thumbnail({ product }: { product: PurchaseCostProduct }) {
  return (
    <span className="cost-thumbnail" aria-hidden="true">
      {product.imageUrl ? (
        <Image
          src={product.imageUrl}
          alt=""
          width={36}
          height={36}
          unoptimized
        />
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          focusable="false"
        >
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <circle cx="8" cy="8" r="1.5" />
          <path d="m4 17 5-5 4 4 3-3 4 4" />
        </svg>
      )}
    </span>
  );
}

export function PurchaseCostsWorkspace({ data }: { data: PurchaseCostsData }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CostFilter>("all");
  const initialRows = Object.fromEntries(
    data.products.map((product) => [
      product.id,
      {
        costInput: formatCostInput(product.currentCost),
        costIsUnit: product.costIsUnit,
        purchased: product.purchased,
        version: product.version,
        status: "idle" as const,
        message: "",
        dirty: false,
        mutation: 0,
        savedMutation: 0,
      },
    ]),
  );
  const [rows, setRows] = useState<Record<string, EditableRow>>(initialRows);
  const rowsRef = useRef(rows);
  const processing = useRef(new Set<string>());
  const inputRefs = useRef(new Map<string, HTMLInputElement[]>());

  function visibleInput(productId: string) {
    const connected = (inputRefs.current.get(productId) ?? []).filter(
      (element) => element.isConnected,
    );
    inputRefs.current.set(productId, connected);
    return connected.find((element) => element.offsetParent !== null);
  }

  function replaceRow(
    productId: string,
    update: (current: EditableRow) => EditableRow,
  ) {
    const next = {
      ...rowsRef.current,
      [productId]: update(rowsRef.current[productId]),
    };
    rowsRef.current = next;
    setRows(next);
  }

  async function flush(productId: string) {
    if (processing.current.has(productId)) return;
    processing.current.add(productId);
    let conflicts = 0;
    try {
      while (true) {
        const target = rowsRef.current[productId];
        if (!target || target.savedMutation >= target.mutation) break;
        const targetMutation = target.mutation;
        replaceRow(productId, (current) => ({
          ...current,
          status: "saving",
          message: "Salvando…",
        }));
        let result;
        try {
          result = await savePurchaseCostAction({
            productId,
            cycleDate: data.cycleDate,
            costInput: target.costInput,
            costIsUnit: target.costIsUnit,
            purchased: target.purchased,
            expectedVersion: target.version,
          });
        } catch {
          replaceRow(productId, (current) => ({
            ...current,
            status: "error",
            message: "Falha de conexão. Tente novamente.",
          }));
          break;
        }
        if (result.status === "error") {
          replaceRow(productId, (current) => ({
            ...current,
            status: "error",
            message: result.message,
          }));
          break;
        }
        if (result.status === "conflict") {
          conflicts += 1;
          replaceRow(productId, (current) => ({
            ...current,
            version: result.value.version,
            status: conflicts < 3 ? "saving" : "error",
            message:
              conflicts < 3
                ? "Sincronizando alteração mais recente…"
                : "O item foi alterado em outra sessão. Tente novamente.",
          }));
          if (conflicts < 3) continue;
          break;
        }
        conflicts = 0;
        replaceRow(productId, (current) => {
          const hasNewerChange = current.mutation > targetMutation;
          return {
            ...current,
            costInput: hasNewerChange
              ? current.costInput
              : formatCostInput(result.value.cost),
            purchased: hasNewerChange
              ? current.purchased
              : result.value.purchased,
            costIsUnit: hasNewerChange
              ? current.costIsUnit
              : result.value.costIsUnit,
            version: result.value.version,
            savedMutation: targetMutation,
            dirty: hasNewerChange ? current.dirty : false,
            status: hasNewerChange ? "saving" : "saved",
            message: hasNewerChange ? "Salvando…" : "Salvo",
          };
        });
      }
    } finally {
      processing.current.delete(productId);
      const latest = rowsRef.current[productId];
      if (latest && latest.savedMutation < latest.mutation && latest.status !== "error")
        void flush(productId);
    }
  }

  function queueSave(
    productId: string,
    patch: Partial<Pick<EditableRow, "costInput" | "costIsUnit" | "purchased">>,
  ) {
    replaceRow(productId, (current) => ({
      ...current,
      ...patch,
      dirty: true,
      mutation: current.mutation + 1,
      status: "saving",
      message: "Salvando…",
    }));
    void flush(productId);
  }

  function saveInput(productId: string) {
    const row = rowsRef.current[productId];
    if (!row.dirty) return true;
    try {
      const cost = validatePurchaseCost(row.costInput, row.purchased);
      queueSave(productId, { costInput: formatCostInput(cost) });
      return true;
    } catch (error) {
      replaceRow(productId, (current) => ({
        ...current,
        status: "error",
        message:
          error instanceof Error ? error.message : "Informe um custo válido.",
      }));
      return false;
    }
  }

  function togglePurchased(productId: string, purchased: boolean) {
    const row = rowsRef.current[productId];
    try {
      const cost = validatePurchaseCost(row.costInput, purchased);
      queueSave(productId, {
        costInput: formatCostInput(cost),
        purchased,
      });
    } catch (error) {
      replaceRow(productId, (current) => ({
        ...current,
        purchased: false,
        status: "error",
        message:
          error instanceof Error ? error.message : "Informe um custo válido.",
      }));
      visibleInput(productId)?.focus();
    }
  }

  const products = useMemo(
    () =>
      data.products.map((product) => ({
        ...product,
        purchased: rows[product.id]?.purchased ?? product.purchased,
      })),
    [data.products, rows],
  );
  const visible = useMemo(
    () => filterPurchaseCostProducts(products, query, filter),
    [products, query, filter],
  );
  const purchasedCount = products.filter((product) => product.purchased).length;
  const position = data.cycles.indexOf(data.cycleDate);
  const previous = data.cycles[position - 1];
  const next = data.cycles[position + 1];
  const savingCount = Object.values(rows).filter(
    (row) => row.status === "saving",
  ).length;
  const errorCount = Object.values(rows).filter(
    (row) => row.status === "error",
  ).length;

  function renderCostInput(product: PurchaseCostProduct, layout: "desktop" | "mobile") {
    const row = rows[product.id];
    const changed = isCostChanged(product.previousCost, row.costInput);
    return (
      <div className="cost-input-wrap">
        <span aria-hidden="true">R$</span>
        <input
          ref={(element) => {
            if (!element) return;
            const current = inputRefs.current.get(product.id) ?? [];
            inputRefs.current.set(
              product.id,
              [...current.filter((candidate) => candidate.isConnected), element],
            );
          }}
          className={changed ? "cost-input cost-input--changed" : "cost-input"}
          aria-label={`Custo atual de ${product.name}`}
          aria-invalid={row.status === "error"}
          aria-describedby={`cost-status-${layout}-${product.id}`}
          inputMode="decimal"
          autoComplete="off"
          value={row.costInput}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) =>
            replaceRow(product.id, (current) => ({
              ...current,
              costInput: event.target.value,
              dirty: true,
              status: "idle",
              message: "",
            }))
          }
          onBlur={() => saveInput(product.id)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            if (!saveInput(product.id)) return;
            const currentIndex = visible.findIndex(
              (candidate) => candidate.id === product.id,
            );
            const nextProduct = visible[currentIndex + 1];
            if (nextProduct)
              requestAnimationFrame(() => {
                const input = visibleInput(nextProduct.id);
                input?.focus();
                input?.select();
              });
          }}
        />
        {changed ? <small>Alterado</small> : null}
      </div>
    );
  }

  function renderPurchaseToggle(product: PurchaseCostProduct) {
    const row = rows[product.id];
    return (
      <label className="purchase-toggle">
        <input
          type="checkbox"
          checked={row.purchased}
          onChange={(event) =>
            togglePurchased(product.id, event.currentTarget.checked)
          }
        />
        <span className="purchase-toggle__desktop-label">
          {row.purchased ? "Comprado" : "Falta comprar"}
        </span>
        <span className="purchase-toggle__mobile-label">
          {row.purchased ? "Comprado" : "Comprar"}
        </span>
      </label>
    );
  }

  function renderUnitCostToggle(product: PurchaseCostProduct) {
    const row = rows[product.id];
    return (
      <label className="cost-basis-toggle">
        <input
          type="checkbox"
          checked={row.costIsUnit}
          onChange={(event) =>
            queueSave(product.id, { costIsUnit: event.currentTarget.checked })
          }
        />
        <span>Custo informado é unitário</span>
      </label>
    );
  }

  function renderRowStatus(productId: string, layout: "desktop" | "mobile") {
    const row = rows[productId];
    return (
      <small
        id={`cost-status-${layout}-${productId}`}
        className={`cost-save-status cost-save-status--${row.status}`}
        role="status"
      >
        {row.message}
      </small>
    );
  }

  return (
    <main className="cost-page">
      <section className="cost-title">
        <div>
          <h1>Lançamento de custos</h1>
          <p>Compra de {dateLabel(data.cycleDate)}</p>
        </div>
        <nav className="cost-cycle" aria-label="Ciclos de compra">
          {previous ? (
            <Link
              className="btn btn--secondary"
              aria-label="Ciclo anterior"
              href={`/comprador/custos?ciclo=${previous}`}
            >
              ‹
            </Link>
          ) : (
            <button className="btn btn--secondary" disabled aria-label="Ciclo anterior">
              ‹
            </button>
          )}
          <label>
            <span className="visually-hidden">Ciclo de compra</span>
            <select
              aria-label="Ciclo de compra"
              value={data.cycleDate}
              onChange={(event) =>
                router.push(`/comprador/custos?ciclo=${event.target.value}`)
              }
            >
              {data.cycles.map((cycle) => (
                <option key={cycle} value={cycle}>
                  {cycle.split("-").reverse().join("/")}
                </option>
              ))}
            </select>
          </label>
          {next ? (
            <Link
              className="btn btn--secondary"
              aria-label="Próximo ciclo"
              href={`/comprador/custos?ciclo=${next}`}
            >
              ›
            </Link>
          ) : (
            <button className="btn btn--secondary" disabled aria-label="Próximo ciclo">
              ›
            </button>
          )}
        </nav>
      </section>

      <section className="cost-metrics" aria-label="Resumo da compra">
        <p>
          <strong>{products.length}</strong> Produtos para comprar
        </p>
        <p>
          <strong>{purchasedCount}</strong> Comprados
        </p>
        <p>
          <strong>{products.length - purchasedCount}</strong> Faltam comprar
        </p>
      </section>

      <div className="cost-tools">
        <label className="field">
          <span className="visually-hidden">
            Buscar produto por nome ou código ERP
          </span>
          <input
            type="search"
            className="search"
            placeholder="Buscar produto (nome ou código)…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="filters" aria-label="Filtrar por estado da compra">
          {(["all", "pending", "purchased"] as const).map((value) => (
            <button
              type="button"
              className="filter"
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value === "all"
                ? "Todos"
                : value === "pending"
                  ? "Faltam comprar"
                  : "Comprados"}
            </button>
          ))}
        </div>
      </div>
      <div className="cost-list-status" aria-live="polite">
        <span>{visible.length} produtos</span>
        <strong className={errorCount ? "has-error" : ""}>
          {errorCount
            ? `${errorCount} item(ns) com erro`
            : savingCount
              ? "Salvando…"
              : "Salvamento automático"}
        </strong>
      </div>

      {!visible.length ? (
        <p className="panel">Nenhum produto encontrado para esta busca/filtro.</p>
      ) : (
        <>
          <table className="cost-table">
            <caption className="visually-hidden">
              Custos da compra de {dateLabel(data.cycleDate)}
            </caption>
            <thead>
              <tr>
                <th scope="col">Código</th>
                <th scope="col">Produto</th>
                <th scope="col">Formato</th>
                {data.stores.map((store) => (
                  <th
                    scope="col"
                    key={store.id}
                    className={`store-heading store-${storeColor(store.slug)}`}
                    title={shortStoreName(store.name)}
                  >
                    {storeLetter(store.slug, store.name)}
                  </th>
                ))}
                <th scope="col">Total pedido</th>
                <th scope="col">Custo anterior</th>
                <th scope="col">Custo atual</th>
                <th scope="col">Comprado</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((product) => (
                <tr key={product.id}>
                  <td>{product.erpCode}</td>
                  <th scope="row">
                    <span className="cost-product-name">
                      <Thumbnail product={product} />
                      <span>
                        {product.name}
                        {product.exclusiveSupplier ? (
                          <small className="exclusive-badge">EXCLUSIVO</small>
                        ) : null}
                      </span>
                    </span>
                  </th>
                  <td>{product.purchaseFormat}</td>
                  {data.stores.map((store) => (
                    <td
                      key={store.id}
                      className={`store-${storeColor(store.slug)}`}
                      aria-label={`${shortStoreName(store.name)}: ${quantity(storeQuantity(product, store))}`}
                    >
                      {quantity(storeQuantity(product, store))}
                    </td>
                  ))}
                  <td className="cost-total">
                    {quantity(product.total)} {product.purchaseFormat}
                  </td>
                  <td>{formatCurrency(product.previousCost)}</td>
                  <td>
                    {renderCostInput(product, "desktop")}
                    {renderUnitCostToggle(product)}
                    {renderRowStatus(product.id, "desktop")}
                  </td>
                  <td>
                    {renderPurchaseToggle(product)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="cost-mobile-list">
            {visible.map((product) => (
              <article className="cost-card" key={product.id}>
                <div className="cost-card-summary">
                  <Thumbnail product={product} />
                  <header className="cost-card-product">
                    <div>
                      <div className="cost-product-meta">
                        <small>{product.erpCode}</small>
                        {renderRowStatus(product.id, "mobile")}
                      </div>
                      <h2>
                        {product.name}
                        {product.exclusiveSupplier ? (
                          <span className="exclusive-badge">EXCLUSIVO</span>
                        ) : null}
                      </h2>
                    </div>
                    <strong>{product.purchaseFormat}</strong>
                  </header>
                  <div className="cost-store-quantities">
                    {data.stores.map((store) => (
                      <span
                        key={store.id}
                        className={`store-${storeColor(store.slug)}`}
                        title={shortStoreName(store.name)}
                      >
                        <b>{storeLetter(store.slug, store.name)}</b>{" "}
                        {quantity(storeQuantity(product, store))}
                      </span>
                    ))}
                    <strong>
                      Total {quantity(product.total)} {product.purchaseFormat}
                    </strong>
                  </div>
                </div>
                <div className="cost-card-fields">
                  <div className="cost-previous-field">
                    <span>Ant.</span>
                    <strong>{formatCurrency(product.previousCost)}</strong>
                  </div>
                  <div className="cost-current-field">
                    <span>Atual</span>
                    {renderCostInput(product, "mobile")}
                    {renderUnitCostToggle(product)}
                  </div>
                  {renderPurchaseToggle(product)}
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
