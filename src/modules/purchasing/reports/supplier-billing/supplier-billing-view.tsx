"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatTaxId } from "@/modules/suppliers/domain";
import {
  type SupplierBillingReport,
  formatCycleDatePtBr,
  formatQuantityPtBr,
  sumQuantities,
} from "./domain";
import "./styles.css";

export function SupplierBillingView({
  report,
  backHref = "/comprador/fornecedores",
}: {
  report: SupplierBillingReport;
  backHref?: string;
}) {
  const router = useRouter();
  const { supplier, stores, consolidatedProducts, productsWithoutOrders, cycleDate, availableCycles } = report;

  const totalConsolidatedVolumes = sumQuantities(
    consolidatedProducts.map((p) => p.totalQuantity)
  );

  return (
    <div className="billing-report">
      <div className="billing-report__actions no-print">
        <div className="billing-report__actions-left">
          <Link href={backHref} className="btn btn--secondary">
            ← Voltar
          </Link>
          <label htmlFor="cycle-select" className="visually-hidden">
            Ciclo de compra
          </label>
          <select
            id="cycle-select"
            className="billing-report__cycle-select"
            value={cycleDate}
            onChange={(e) => router.push(`?ciclo=${e.target.value}`)}
          >
            {availableCycles.map((cycle) => (
              <option key={cycle} value={cycle}>
                Compra de {formatCycleDatePtBr(cycle)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => window.print()}
        >
          Imprimir / Salvar PDF
        </button>
      </div>

      <header className="billing-report__header">
        <div className="billing-report__brand">
          <Image src="/brand/MS-H.png" alt="MultiShow FLV" width={170} height={43} priority />
          <h1>Relatório de Faturamento por Fornecedor</h1>
          <p className="billing-report__subtitle">
            Instrução de faturamento e separação de pedidos exclusivos por loja
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <strong>Ciclo de Compra</strong>
          <div style={{ fontSize: "16px", fontWeight: "700", color: "#0f172a" }}>
            {formatCycleDatePtBr(cycleDate)}
          </div>
        </div>
      </header>

      <section className="billing-report__supplier-card" aria-label="Identificação do fornecedor">
        <div className="billing-report__supplier-grid">
          <dl className="billing-report__supplier-field">
            <dt>Fornecedor (Razão Social)</dt>
            <dd>{supplier.corporateName}</dd>
          </dl>
          {supplier.tradeName ? (
            <dl className="billing-report__supplier-field">
              <dt>Nome Fantasia</dt>
              <dd>{supplier.tradeName}</dd>
            </dl>
          ) : null}
          <dl className="billing-report__supplier-field">
            <dt>{supplier.taxIdType === "CPF" ? "CPF" : "CNPJ"}</dt>
            <dd>{supplier.taxId ? formatTaxId(supplier.taxId) : "Não informado"}</dd>
          </dl>
          <dl className="billing-report__supplier-field">
            <dt>Regra de Emissão de NF</dt>
            <dd>
              {supplier.taxInvoiceRule === "STANDARD"
                ? "Emissão normal"
                : supplier.taxInvoiceRule === "AFTER_WEIGHING"
                ? "Após pesagem"
                : "Regime especial"}
            </dd>
          </dl>
        </div>
      </section>

      {/* SEÇÃO 1: RESUMO CONSOLIDADO */}
      <section className="billing-section" aria-label="Resumo consolidado">
        <div className="billing-section__title">
          <span>1. Resumo Consolidado — Total a Faturar</span>
          <span style={{ fontSize: "13px", fontWeight: "600", color: "#64748b" }}>
            Total Geral: {formatQuantityPtBr(totalConsolidatedVolumes)} volumes
          </span>
        </div>
        <table className="billing-table">
          <thead>
            <tr>
              <th style={{ width: "65px" }}>ERP</th>
              <th>Produto</th>
              <th style={{ width: "55px" }} className="center">Unid.</th>
              <th style={{ width: "55px" }} className="center">Fmt.</th>
              {stores.map((s) => (
                <th key={s.storeId} className="num" style={{ minWidth: "100px" }}>
                  {s.storeName.replace("MultiShow ", "")}
                </th>
              ))}
              <th className="num" style={{ width: "110px" }}>Total a Faturar</th>
            </tr>
          </thead>
          <tbody>
            {consolidatedProducts.length > 0 ? (
              consolidatedProducts.map((item) => (
                <tr key={item.productId}>
                  <td>{item.erpCode}</td>
                  <td><strong>{item.productName}</strong></td>
                  <td className="center">{item.unit}</td>
                  <td className="center">{item.purchaseFormat}</td>
                  {stores.map((s) => (
                    <td key={s.storeId} className="num">
                      {item.storeQuantities[s.storeId] === "—"
                        ? "—"
                        : formatQuantityPtBr(item.storeQuantities[s.storeId])}
                    </td>
                  ))}
                  <td className="num">
                    <strong>{formatQuantityPtBr(item.totalQuantity)} {item.purchaseFormat}</strong>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5 + stores.length} style={{ textAlign: "center", padding: "16px" }}>
                  Nenhum produto exclusivo teve solicitação de compra neste ciclo.
                </td>
              </tr>
            )}
          </tbody>
          {consolidatedProducts.length > 0 ? (
            <tfoot>
              <tr>
                <td colSpan={4}><strong>TOTAL DE VOLUMES CONSOLIDADOS</strong></td>
                {stores.map((s) => (
                  <td key={s.storeId} className="num">
                    <strong>{formatQuantityPtBr(s.totalQuantity)}</strong>
                  </td>
                ))}
                <td className="num">
                  <strong>{formatQuantityPtBr(totalConsolidatedVolumes)}</strong>
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </section>

      {/* SEÇÃO 2: SEÇÕES POR LOJA (PARA EMISSÃO DE NOTA FISCAL INDIVIDUAL) */}
      <section className="billing-section" aria-label="Faturamento por loja">
        <div className="billing-section__title">
          <span>2. Faturamento por Loja (Para Emissão de Notas Fiscais Individuais)</span>
        </div>
        <p style={{ fontSize: "12px", color: "#64748b", margin: "-4px 0 16px 0" }}>
          Cada seção abaixo deve ser utilizada para faturar a respectiva nota fiscal individual contra a unidade compradora.
        </p>

        {stores.map((store) => (
          <article key={store.storeId} className="billing-store-card">
            <header className="billing-store-card__header">
              <div>
                <h3>{store.storeName}</h3>
                <span className="billing-store-card__meta">
                  {store.hasOrder && store.submittedAt
                    ? `Pedido enviado em ${new Date(store.submittedAt).toLocaleDateString("pt-BR")} às ${new Date(store.submittedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} (Revisão ${store.revision})`
                    : "Sem pedido válido"}
                </span>
              </div>
              <div>
                {store.hasOrder ? (
                  <span style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a" }}>
                    Total da NF: {formatQuantityPtBr(store.totalQuantity)} volumes
                  </span>
                ) : null}
              </div>
            </header>

            {store.hasOrder ? (
              store.items.length > 0 ? (
                <table className="billing-table">
                  <thead>
                    <tr>
                      <th style={{ width: "70px" }}>ERP</th>
                      <th>Produto</th>
                      <th style={{ width: "65px" }} className="center">Unid.</th>
                      <th style={{ width: "65px" }} className="center">Formato</th>
                      <th className="num" style={{ width: "130px" }}>Qtd. a Faturar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {store.items.map((item) => (
                      <tr key={item.productId}>
                        <td>{item.erpCode}</td>
                        <td>{item.productName}</td>
                        <td className="center">{item.unit}</td>
                        <td className="center">{item.purchaseFormat}</td>
                        <td className="num">
                          <strong>{formatQuantityPtBr(item.quantity)} {item.purchaseFormat}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4}><strong>TOTAL A FATURAR NESTA LOJA</strong></td>
                      <td className="num">
                        <strong>{formatQuantityPtBr(store.totalQuantity)} volumes</strong>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              ) : (
                <p className="billing-store-empty">
                  Esta loja enviou pedido para o ciclo, mas nenhum dos produtos exclusivos deste fornecedor foi solicitado.
                </p>
              )
            ) : (
              <p className="billing-store-empty">
                ⚠️ Nenhum pedido operacional válido enviado por esta loja para o ciclo selecionado.
              </p>
            )}
          </article>
        ))}
      </section>

      {/* SEÇÃO 3: PRODUTOS EXCLUSIVOS SEM DEMANDA NO CICLO */}
      {productsWithoutOrders.length > 0 ? (
        <aside className="billing-zero-demand">
          <strong>Produtos exclusivos sem solicitação no ciclo ({productsWithoutOrders.length} itens):</strong>
          <p style={{ margin: "4px 0 0 0" }}>
            Os seguintes produtos estão atribuídos a este fornecedor como exclusivos, mas não receberam pedidos com quantidade em nenhuma das 3 lojas neste ciclo:
          </p>
          <ul>
            {productsWithoutOrders.map((p) => (
              <li key={p.productId}>
                ERP {p.erpCode}: <strong>{p.productName}</strong> ({p.purchaseFormat})
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
    </div>
  );
}
