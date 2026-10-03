import Image from "next/image";
import Link from "next/link";
import { OrderPrintButton } from "@/app/pedidos/[id]/impressao/print-button";
import {
  filterReportItems,
  formatCycleDate,
  formatDateTime,
  formatOrderQuantity,
  ORDER_PRINT_TWO_COLUMN_THRESHOLD,
  sortReportItems,
  splitReportItems,
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

function renderProductTable(
  items: OrderReportItem[],
  isConference: boolean,
  captionText: string,
  keyPrefix = "single",
) {
  return (
    <table className="order-report__table">
      <caption className="visually-hidden">{captionText}</caption>
      <thead>
        <tr>
          <th scope="col" className="col-code">
            Cód.
          </th>
          <th scope="col" className="col-product">
            Produto
          </th>
          <th scope="col" className="col-unit">
            Unid.
          </th>
          <th scope="col" className="col-quantity">
            Qtd.
          </th>
          {isConference ? (
            <th scope="col" className="col-check">
              Recebido
            </th>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={`${keyPrefix}-${item.erpCode}`}>
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
    </table>
  );
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
  const useTwoColumns = !isConference && filteredItems.length > ORDER_PRINT_TWO_COLUMN_THRESHOLD;
  const [leftItems, rightItems] = useTwoColumns
    ? splitReportItems(filteredItems)
    : [filteredItems, []];

  return (
    <main
      className={`order-report ${
        useTwoColumns ? "order-report--two-columns" : "order-report--single-column"
      } ${isConference ? "order-report--conferencia" : "order-report--pedido"}`}
    >
      <div className="order-report__actions no-print">
        <Link className="btn btn--secondary" href={returnUrl}>
          ← Voltar ao pedido
        </Link>
        <OrderPrintButton label="Imprimir / Salvar PDF" />
      </div>

      <header className="order-report__header">
        <div className="order-report__header-row">
          <div className="order-report__identity">
            <div className="order-report__brand">
              <Image
                src="/brand/MS-H.png"
                alt="MultiShow FLV"
                width={120}
                height={30}
                priority
                unoptimized
              />
            </div>
            <div className="order-report__title-block">
              <h1>{title}</h1>
              <span className="order-report__badge">{`Revisão ${order.revision}`}</span>
            </div>
          </div>

          <div className="order-report__meta-box">
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
        <section className="order-report__body">
          {useTwoColumns ? (
            <div className="order-report__columns">
              <div className="order-report__col">
                {renderProductTable(
                  leftItems,
                  false,
                  `${title} — ${storeName} — Revisão ${order.revision} (Coluna 1)`,
                  "c1",
                )}
              </div>
              <div className="order-report__col">
                {renderProductTable(
                  rightItems,
                  false,
                  `${title} — ${storeName} — Revisão ${order.revision} (Coluna 2)`,
                  "c2",
                )}
              </div>
            </div>
          ) : (
            <div className="order-report__table-wrap">
              {renderProductTable(
                filteredItems,
                isConference,
                `${title} — ${storeName} — Revisão ${order.revision}`,
                "single",
              )}
            </div>
          )}

          <div className="order-report__summary">
            <span>Total de itens pedidos:</span>
            <strong>
              {`${filteredItems.length} ${filteredItems.length === 1 ? "item" : "itens"}`}
            </strong>
          </div>
        </section>
      )}
    </main>
  );
}
