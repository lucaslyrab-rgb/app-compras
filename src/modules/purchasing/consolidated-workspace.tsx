"use client";

import { useEffect, useMemo, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ProductPhoto } from "@/components/product-photo";
import {
  filterConsolidatedProducts,
  shortStoreName,
  storeColor,
  type ConsolidatedData,
  type ConsolidatedProduct,
  type ConsolidatedStore,
  type OrderFilter,
} from "./domain";
import { storeInitials } from "./reports/consolidated-print/domain";

const quantityFormat = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 2,
});
const timestampFormat = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "short",
});
const compactTimestampFormat = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const updatedTimeFormat = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
function quantity(value: string) {
  return quantityFormat.format(Number(value));
}
function dateLabel(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "long",
  }).format(new Date(`${value}T12:00:00Z`));
}
function compactTimestamp(value: string) {
  const parts = compactTimestampFormat.formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("day")}/${part("month")} ${part("hour")}:${part("minute")}`;
}

function Thumbnail({ product }: { product: ConsolidatedProduct }) {
  return (
    <ProductPhoto
      productId={product.id}
      name={product.name}
      photoKey={product.photoKey}
      photoUpdatedAt={product.photoUpdatedAt}
      imageUrl={product.imageUrl}
      size={36}
      thumbnailClassName="buyer-thumbnail"
    />
  );
}

function Value({
  product,
  store,
  field,
}: {
  product: ConsolidatedProduct;
  store: ConsolidatedStore;
  field: "stock" | "quantity";
}) {
  const value = product.stores[store.id];
  return value ? (
    <>{quantity(value[field])}</>
  ) : (
    <span
      title={
        store.order
          ? "Produto não informado neste pedido"
          : "Loja sem pedido operacional válido"
      }
      aria-label={
        store.order
          ? "Produto não informado neste pedido"
          : "Loja sem pedido operacional válido"
      }
    >
      —
    </span>
  );
}

export function ConsolidatedWorkspace({ data }: { data: ConsolidatedData }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<OrderFilter>("all");
  const [refreshing, startRefresh] = useTransition();
  const [showStock, setShowStock] = useState(true);
  const visible = useMemo(
    () => filterConsolidatedProducts(data.products, query, filter),
    [data.products, query, filter],
  );
  const sent = data.stores.filter((store) => store.order).length;
  const position = data.cycles.indexOf(data.cycleDate);
  const previous = data.cycles[position - 1];
  const next = data.cycles[position + 1];
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [router]);

  return (
    <main className="buyer-page">
      <section className="buyer-title">
        <div>
          <h1>Consolidado de pedidos</h1>
          <p>Compra de {dateLabel(data.cycleDate)}</p>
        </div>
        <nav className="buyer-cycle" aria-label="Ciclos de compra">
          {previous ? (
            <Link
              className="btn btn--secondary"
              aria-label="Ciclo anterior"
              href={`/comprador/consolidado?ciclo=${previous}`}
            >
              ‹
            </Link>
          ) : (
            <button
              className="btn btn--secondary"
              aria-label="Ciclo anterior"
              disabled
            >
              ‹
            </button>
          )}
          <label>
            <span className="visually-hidden">Ciclo de compra</span>
            <select
              aria-label="Ciclo de compra"
              value={data.cycleDate}
              onChange={(event) =>
                router.push(
                  `/comprador/consolidado?ciclo=${event.target.value}`,
                )
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
              href={`/comprador/consolidado?ciclo=${next}`}
            >
              ›
            </Link>
          ) : (
            <button
              className="btn btn--secondary"
              aria-label="Próximo ciclo"
              disabled
            >
              ›
            </button>
          )}
        </nav>
      </section>
      <section className="buyer-status" aria-label="Envio das lojas">
        <div>
          <strong>
            {sent} de {data.stores.length} lojas enviaram
          </strong>
          <p>
            {sent < data.stores.length
              ? "Envios incompletos — totais parciais."
              : "Todas as lojas têm pedido operacional válido."}
          </p>
        </div>
        <ul>
          {data.stores.map((store) => (
            <li key={store.id} className={`store-${storeColor(store.slug)}`}>
              <strong>
                {store.order ? "✓" : "⚠"} {shortStoreName(store.name)}
              </strong>
              <span>
                {store.order ? (
                  <>
                    <time
                      className="store-time store-time--desktop"
                      dateTime={store.order.submittedAt}
                    >
                      {timestampFormat.format(
                        new Date(store.order.submittedAt),
                      )}
                    </time>
                    <time
                      className="store-time store-time--mobile"
                      dateTime={store.order.submittedAt}
                    >
                      {compactTimestamp(store.order.submittedAt)}
                    </time>
                  </>
                ) : (
                  "Não enviado"
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className="buyer-metrics" aria-label="Resumo do ciclo">
        <p>
          <strong>{data.products.filter((p) => p.active).length}</strong>
          Produtos cadastrados ativos
        </p>
        <p>
          <strong>
            {data.products.filter((p) => Number(p.total) > 0).length}
          </strong>
          Produtos com pedido
        </p>
        <p>
          <strong>
            {sent}/{data.stores.length}
          </strong>
          Lojas enviadas
        </p>
      </section>
      <div className="buyer-tools">
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
        <div className="filters" aria-label="Filtrar por total pedido">
          {(["all", "filled", "empty"] as const).map((value) => (
            <button
              type="button"
              className="filter"
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value === "all"
                ? "Todos"
                : value === "filled"
                  ? "Com pedido"
                  : "Sem pedido"}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={refreshing}
          onClick={() => startRefresh(() => router.refresh())}
        >
          {refreshing ? "Atualizando…" : "Atualizar"}
        </button>
        <Link
          className="btn btn--secondary buyer-print-link"
          href={`/relatorios/consolidado?ciclo=${data.cycleDate}`}
          target="_blank"
          rel="noopener"
        >
          Imprimir A4
        </Link>
        <label className="buyer-stock-toggle">
          <input type="checkbox" checked={showStock} onChange={(event) => setShowStock(event.target.checked)} />
          Mostrar estoque
        </label>
      </div>
      <p className="buyer-updated" role="status">
        {visible.length} produtos • Atualizado às{" "}
        {updatedTimeFormat.format(new Date(data.loadedAt))}
      </p>
      {!visible.length ? (
        <p className="panel">
          Nenhum produto encontrado para esta busca/filtro.
        </p>
      ) : (
        <>
          <table className="buyer-table">
            <caption className="visually-hidden">
              Pedidos por loja — compra de {dateLabel(data.cycleDate)}
            </caption>
            <colgroup>
              <col style={{ width: "7%" }} />
              <col style={{ width: "22%" }} />
              <col style={{ width: "7%" }} />
              {data.stores.flatMap((store) => [
                <col key={`${store.id}-s`} />,
                <col key={`${store.id}-q`} />,
              ])}
              <col style={{ width: "12%" }} />
            </colgroup>
            <thead>
              <tr>
                <th rowSpan={2} scope="col">
                  Código
                </th>
                <th rowSpan={2} scope="col">
                  Produto
                </th>
                <th rowSpan={2} scope="col">
                  Formato
                </th>
                {data.stores.map((store) => (
                  <th
                    key={store.id}
                    colSpan={2}
                    scope="colgroup"
                    className={`store-heading store-${storeColor(store.slug)}`}
                  >
                    {shortStoreName(store.name)}
                  </th>
                ))}
                <th rowSpan={2} scope="col">
                  Total pedido
                </th>
              </tr>
              <tr>
                {data.stores.flatMap((store) => [
                  <th
                    key={`${store.id}-s`}
                    scope="col"
                    className={`store-${storeColor(store.slug)}`}
                  >
                    Estoque
                  </th>,
                  <th
                    key={`${store.id}-q`}
                    scope="col"
                    className={`store-${storeColor(store.slug)}`}
                  >
                    Pedido
                  </th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {visible.map((product) => (
                <tr key={product.id}>
                  <td>{product.erpCode}</td>
                  <th scope="row">
                    <span className="buyer-product-name">
                      <Thumbnail product={product} />
                      <span>
                        {product.name}
                        {!product.active ? (
                          <small>Inativo · presente no pedido</small>
                        ) : null}
                      </span>
                    </span>
                  </th>
                  <td>{product.purchaseFormat}</td>
                  {data.stores.flatMap((store) => [
                    <td
                      key={`${store.id}-s`}
                      className={`store-${storeColor(store.slug)}`}
                    >
                      <Value product={product} store={store} field="stock" />
                    </td>,
                    <td
                      key={`${store.id}-q`}
                      className={`store-${storeColor(store.slug)}`}
                    >
                      <Value product={product} store={store} field="quantity" />
                    </td>,
                  ])}
                  <td className="buyer-total">
                    {quantity(product.total)} {product.purchaseFormat}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Celular: uma linha por produto, colunas por loja (PF · BA · SM) como a
              folha de compra em papel; pedido em destaque e estoque opcional. */}
          <div
            className="buyer-mobile-list"
            role="table"
            aria-label={`Pedidos por loja — compra de ${dateLabel(data.cycleDate)}`}
            data-show-stock={showStock ? "true" : "false"}
            style={{ "--store-count": data.stores.length } as CSSProperties}
          >
            <div className="buyer-mobile-row buyer-mobile-row--head" role="row">
              <span role="columnheader">Produto</span>
              {data.stores.map((store) => (
                <span
                  key={store.id}
                  role="columnheader"
                  className={`buyer-mobile-store buyer-mobile-store--head store-${storeColor(store.slug)}`}
                  title={shortStoreName(store.name)}
                >
                  {storeInitials(store.name)}
                </span>
              ))}
              <span role="columnheader" className="buyer-mobile-total">Total</span>
            </div>
            {visible.map((product) => (
              <div className="buyer-mobile-row" role="row" key={product.id} aria-label={product.name}>
                <span className="buyer-mobile-name" role="rowheader">
                  <strong>{product.name}</strong>
                  <small>
                    {product.purchaseFormat} · {product.erpCode}
                    {!product.active ? " · Inativo" : ""}
                  </small>
                </span>
                {data.stores.map((store) => {
                  const value = product.stores[store.id];
                  const ordered = value ? Number(value.quantity) : 0;
                  return (
                    <span
                      key={store.id}
                      role="cell"
                      className={`buyer-mobile-store store-${storeColor(store.slug)}`}
                      aria-label={`${shortStoreName(store.name)}: pedido ${value ? quantity(value.quantity) : "não informado"}${value ? `, estoque ${quantity(value.stock)}` : ""}`}
                    >
                      <strong className={ordered > 0 ? "" : "is-zero"}>{ordered > 0 ? quantity(value!.quantity) : "–"}</strong>
                      {value ? <small className="buyer-mobile-stock">est {quantity(value.stock)}</small> : null}
                    </span>
                  );
                })}
                <strong className="buyer-mobile-total" role="cell">
                  {quantity(product.total)}
                </strong>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
