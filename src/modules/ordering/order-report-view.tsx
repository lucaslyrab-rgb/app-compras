import Image from "next/image";
import Link from "next/link";
import { OrderPrintButton } from "@/app/pedidos/[id]/impressao/print-button";
import {
  filterReportItems,
  formatCycleDate,
  formatDateTime,
  formatOrderQuantity,
  sortReportItems,
  type OrderReportHeader,
  type OrderReportItem,
} from "./domain";

export interface OrderReportViewProps {
  order: OrderReportHeader;
  storeName: string;
  items: OrderReportItem[];
  variant?: "pedido" | "conferencia";
  backHref?: string;
}

export function OrderReportView({
  order,
  storeName,
  items,
  variant = "pedido",
  backHref,
}: OrderReportViewProps) {
  const returnUrl = backHref ?? `/pedidos/${order.id}/detalhes`;
  const filteredItems = sortReportItems(filterReportItems(items));
  const isConference = variant === "conferencia";
  const title = isConference ? "CONFERÊNCIA DE RECEBIMENTO — FLV" : "PEDIDO FLV";

  return (
    <main className="order-report">
      <div className="order-report__actions no-print">
        <Link className="btn btn--secondary" href={returnUrl}>
          ← Voltar ao pedido
        </Link>
        <OrderPrintButton label="Imprimir / Salvar PDF" />
      </div>

      <header className="order-report__header">
        <div className="order-report__header-top">
          <div className="order-report__brand">
            <Image
              src="/brand/MS-H.png"
              alt="MultiShow FLV"
              width={160}
              height={40}
              priority
              unoptimized
            />
          </div>
          <div className="order-report__title-block">
            <h1>{title}</h1>
            <span className="order-report__badge">{`Revisão ${order.revision}`}</span>
          </div>
        </div>

        <div className="order-report__meta-grid">
          <div className="order-report__meta-item">
            <span className="order-report__meta-label">Loja</span>
            <strong className="order-report__meta-value">{storeName}</strong>
          </div>
          <div className="order-report__meta-item">
            <span className="order-report__meta-label">Ciclo de compra</span>
            <strong className="order-report__meta-value">
              {formatCycleDate(order.purchaseCycleDate)}
            </strong>
          </div>
          <div className="order-report__meta-item">
            <span className="order-report__meta-label">Data e horário de envio</span>
            <strong className="order-report__meta-value">
              {formatDateTime(order.submittedAt)}
            </strong>
          </div>
          <div className="order-report__meta-item">
            <span className="order-report__meta-label">Número da revisão</span>
            <strong className="order-report__meta-value">{order.revision}</strong>
          </div>
        </div>

        {order.cancelledAt ? (
          <aside className="order-report__cancelled-banner" role="alert">
            <div className="order-report__cancelled-title">PEDIDO CANCELADO</div>
            <div className="order-report__cancelled-details">
              Cancelado em {formatDateTime(order.cancelledAt)}
              {order.cancellationReason ? ` — Motivo: ${order.cancellationReason}` : ""}
            </div>
          </aside>
        ) : null}

        {isConference ? (
          <div className="order-report__conference-meta">
            <p>
              <strong>Data do recebimento:</strong> ____________________
            </p>
            <p>
              <strong>Responsável pelo recebimento:</strong> ____________________
            </p>
          </div>
        ) : null}
      </header>

      {filteredItems.length === 0 ? (
        <section className="order-report__empty">
          <p>Nenhum produto com quantidade pedida nesta revisão.</p>
        </section>
      ) : (
        <section className="order-report__table-wrap">
          <table className="order-report__table">
            <caption className="visually-hidden">
              {`${title} — ${storeName} — Revisão ${order.revision}`}
            </caption>
            <thead>
              <tr>
                <th scope="col" className="col-code">
                  Código
                </th>
                <th scope="col" className="col-product">
                  Produto
                </th>
                <th scope="col" className="col-unit">
                  Unidade
                </th>
                <th scope="col" className="col-quantity">
                  Quantidade pedida
                </th>
                {isConference ? (
                  <th scope="col" className="col-check">
                    Recebido
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr key={item.erpCode}>
                  <td className="col-code">{item.erpCode}</td>
                  <td className="col-product">{item.name}</td>
                  <td className="col-unit">{item.unit}</td>
                  <td className="col-quantity">{formatOrderQuantity(item.quantity)}</td>
                  {isConference ? (
                    <td className="col-check">
                      <span className="order-report__check-line" aria-label="Espaço para conferência" />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={isConference ? 3 : 2}>Total de itens pedidos</td>
                <td className="col-quantity">
                  <strong>
                    {`${filteredItems.length} ${filteredItems.length === 1 ? "item" : "itens"}`}
                  </strong>
                </td>
                {isConference ? <td /> : null}
              </tr>
            </tfoot>
          </table>
        </section>
      )}
    </main>
  );
}
