"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  filterConsolidatedProducts,
  shortStoreName,
  storeColor,
  type ConsolidatedData,
  type ConsolidatedProduct,
  type ConsolidatedStore,
  type OrderFilter,
} from "./domain";

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
    <span className="buyer-thumbnail" aria-hidden="true">
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
          <div className="buyer-mobile-list">
            {visible.map((product) => (
              <article
                className="buyer-card"
                key={product.id}
                aria-label={product.name}
              >
                <header>
                  <Thumbnail product={product} />
                  <div>
                    <small>
                      {product.erpCode}
                      {!product.active ? " · Inativo" : ""}
                    </small>
                    <h2>{product.name}</h2>
                  </div>
                  <strong>{product.purchaseFormat}</strong>
                </header>
                <table>
                  <caption className="visually-hidden">
                    Estoque e pedido de {product.name} por loja
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Loja</th>
                      <th scope="col">Est.</th>
                      <th scope="col">Pedido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.stores.map((store) => (
                      <tr
                        key={store.id}
                        className={`store-${storeColor(store.slug)}`}
                      >
                        <th scope="row">{shortStoreName(store.name)}</th>
                        <td>
                          <Value
                            product={product}
                            store={store}
                            field="stock"
                          />
                        </td>
                        <td>
                          <Value
                            product={product}
                            store={store}
                            field="quantity"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <footer>
                  <span>Total pedido</span>
                  <strong>
                    {quantity(product.total)} {product.purchaseFormat}
                  </strong>
                </footer>
              </article>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
