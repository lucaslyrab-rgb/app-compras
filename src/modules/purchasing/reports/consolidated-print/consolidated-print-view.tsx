import Link from "next/link";
import type { ConsolidatedPrintModel, PrintRow } from "./domain";
import { PrintButton } from "./print-button";
import "./styles.css";
import { Fragment } from "react";
import { PACKAGED_SECTION_LABEL, startsPackagedSection } from "@/lib/product-sections";

const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const printedAt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function cycleLabel(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function Column({ rows, model }: { rows: PrintRow[]; model: ConsolidatedPrintModel }) {
  return (
    <table className="cprint-table">
      <thead>
        <tr>
          <th scope="col" className="cprint-name">Produto</th>
          {model.stores.map((store) => (
            <th scope="col" key={store.id} title={store.name}>{store.initials}</th>
          ))}
          <th scope="col" className="cprint-total">Total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <Fragment key={row.id}>
          {startsPackagedSection(rows, index) ? (
            <tr className="packaged-heading-row"><td colSpan={model.stores.length + 2}>{PACKAGED_SECTION_LABEL}</td></tr>
          ) : null}
          <tr className={row.total > 0 ? "has-order" : undefined}>
            <th scope="row" className="cprint-name">{row.name}</th>
            {row.quantities.map((q, index) => (
              <td key={model.stores[index].id} className={q === null ? "is-empty" : undefined}>
                {q === null ? "–" : number.format(q)}
              </td>
            ))}
            <td className={`cprint-total${row.total > 0 ? "" : " is-empty"}`}>
              {row.total > 0 ? `${number.format(row.total)} ${row.unit}` : "–"}
            </td>
          </tr>
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

export function ConsolidatedPrintView({ model, now = new Date() }: { model: ConsolidatedPrintModel; now?: Date }) {
  const legend = model.stores.map((store) => `${store.initials} ${store.name}`).join(" · ");
  const missing = model.stores.filter((store) => !store.sent).map((store) => store.name);
  return (
    <div className="cprint-screen">
      <div className="cprint-toolbar no-print">
        <Link className="btn btn--secondary" href={`/comprador/consolidado?ciclo=${model.cycleDate}`}>
          Voltar ao Consolidado
        </Link>
        <PrintButton />
      </div>
      <article className={`cprint-sheet cprint-sheet--${model.density}`} aria-label="Relatório consolidado A4">
        <header className="cprint-header">
          <div>
            <h1>Consolidado de Pedidos FLV</h1>
            <p>MultiShow · {legend}</p>
          </div>
          <div className="cprint-meta">
            <strong>Compra {cycleLabel(model.cycleDate)}</strong>
            <span>
              Impresso em {printedAt.format(now)} · {model.productsWithOrder} de {model.totalProducts} produtos com pedido
            </span>
            {missing.length > 0 ? <span className="cprint-warning">Sem pedido enviado: {missing.join(", ")}</span> : null}
          </div>
        </header>
        <div className="cprint-columns">
          <Column rows={model.columns[0]} model={model} />
          <Column rows={model.columns[1]} model={model} />
        </div>
        <footer className="cprint-footer">
          <span>– = sem pedido (anote oportunidades por cima). Produtos com pedido em negrito.</span>
          <span>Comprador: ______________________</span>
        </footer>
      </article>
    </div>
  );
}
