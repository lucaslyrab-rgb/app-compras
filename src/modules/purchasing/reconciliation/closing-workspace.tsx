import Link from "next/link";
import { LOSS_WINDOW_DAYS, WEIGHT_RANGE_PERCENT, type ReconciliationLine } from "./domain";
import {
  JOURNEY_FILTERS,
  JOURNEY_FILTER_LABELS,
  type JourneyFilter,
  type JourneyIssue,
  type ProductJourney,
  type QuantityGroup,
  type StoreValue,
} from "./closing";
import type { ClosingOverview } from "./closing-service";
import "./closing.css";

const BASE_PATH = "/fechamento";

type Option = { id: string; name: string };

const num = (value: number, digits = 2) =>
  value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const qty = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const money = (value: number) => `R$ ${num(value)}`;
const signedMoney = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}R$ ${num(Math.abs(value))}`;
const signedPct = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${num(Math.abs(value), 1)}%`;
const groupsText = (groups: QuantityGroup[]) => groups.map((g) => `${qty(g.quantity)} ${g.unit}`).join(" + ");
const dateLabel = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

/** Mesma faixa da pesagem: até 5% acima é normal, até 5% abaixo é atenção, além disso é problema. */
function pctTone(percent: number | null): "ok" | "warn" | "bad" | "muted" {
  if (percent === null) return "muted";
  if (Math.abs(percent) > WEIGHT_RANGE_PERCENT) return "bad";
  return percent < 0 ? "warn" : "ok";
}

function moneyTone(value: number | null): "ok" | "warn" | "bad" | "muted" {
  if (value === null) return "muted";
  if (value < 0) return "bad";
  return "ok";
}

function href(overview: ClosingOverview, changes: Record<string, string | undefined>) {
  const f = overview.filters;
  const params = new URLSearchParams();
  const base: Record<string, string | undefined> = {
    ciclo: f.cycleDate ?? undefined,
    aba: f.tab === "valores" ? "valores" : undefined,
    loja: f.storeId,
    busca: f.search,
    desfecho: f.filter,
  };
  for (const [key, value] of Object.entries({ ...base, ...changes })) if (value) params.set(key, value);
  const qs = params.toString();
  return `${BASE_PATH}${qs ? `?${qs}` : ""}`;
}

const ISSUE_TONE: Record<JourneyIssue, string> = {
  NOT_PURCHASED: "bad",
  PURCHASED_NOT_DESTINED: "bad",
  CONFERENCE_DIFFERENCE: "warn",
  CUT: "warn",
  ADDITIONAL: "info",
  CONFERENCE_PENDING: "muted",
};

function issueLabel(issue: JourneyIssue, journey: ProductJourney): string {
  switch (issue) {
    case "NOT_PURCHASED":
      return "Pedido e não comprado";
    case "PURCHASED_NOT_DESTINED":
      return "Comprado sem destinação";
    case "CONFERENCE_DIFFERENCE":
      return "Diferença na conferência";
    case "CUT": {
      const c = journey.cut;
      if (c?.difference != null && c.unit) return `Corte −${qty(Math.abs(c.difference))} ${c.unit}`;
      return `Corte em ${c?.stores ?? 0} loja(s)`;
    }
    case "ADDITIONAL": {
      const a = journey.additional;
      if (a?.difference != null && a.unit) return `Adicional +${qty(a.difference)} ${a.unit}`;
      return "Adicional";
    }
    default:
      return "Aguardando conferência";
  }
}

function OutcomeTags({ journey }: { journey: ProductJourney }) {
  if (journey.issues.length === 0) return <span className="cl-tag cl-tag--ok">Tudo certo</span>;
  return (
    <span className="cl-tags">
      {journey.issues.map((issue) => (
        <span key={issue} className={`cl-tag cl-tag--${ISSUE_TONE[issue]}`}>{issueLabel(issue, journey)}</span>
      ))}
    </span>
  );
}

function Step({ label, main, note, tone }: { label: string; main: React.ReactNode; note?: React.ReactNode; tone?: string }) {
  return (
    <span className="cl-step">
      <span className="cl-step__label">{label}</span>
      <strong className={tone ? `cl-text--${tone}` : undefined}>{main}</strong>
      {note ? <small>{note}</small> : null}
    </span>
  );
}

function ConferenceStep({ journey }: { journey: ProductJourney }) {
  const c = journey.conference;
  if (!c) return <Step label="Conferência" main="—" tone="muted" />;
  const stores = `${c.storesFinalized} de ${c.storesWithDestination} loja(s)`;
  if (c.expectedKg > 0) {
    return (
      <Step
        label="Conferência"
        main={<>{num(c.receivedKg, 1)} kg <span className={`cl-text--${pctTone(c.percent)}`}>{c.percent === null ? "" : signedPct(c.percent)}</span></>}
        note={`esperado ${num(c.expectedKg, 1)} kg · ${stores}${c.notReceived ? ` · ${c.notReceived} não recebido` : ""}`}
      />
    );
  }
  if (c.storesFinalized < c.storesWithDestination) return <Step label="Conferência" main="Pendente" note={stores} tone="muted" />;
  return <Step label="Conferência" main={c.notReceived ? `${c.notReceived} não recebido` : "Conferido"} note={stores} tone={c.notReceived ? "bad" : undefined} />;
}

function StoreConference({ line }: { line: ReconciliationLine }) {
  const { state, item } = line.conference;
  if (!line.destinedPositive && !item) return <span className="cl-muted">—</span>;
  if (state === "NONE") return <span className="cl-muted">Sem conferência</span>;
  if (state === "CANCELLED") return <span className="cl-muted">Cancelada</span>;
  if (!item) return <span className="cl-muted">{state === "FINALIZED" ? "Fora da conferência" : "Pendente"}</span>;
  if (item.isUnreceived) return <span className="cl-text--bad">Não recebido</span>;
  if (item.weightKg === null) return <span className="cl-muted">Sem pesagem</span>;
  return (
    <>
      {num(item.weightKg, 1)} kg{" "}
      {line.weight ? <span className={`cl-text--${pctTone(line.weight.differencePercent)}`}>{signedPct(line.weight.differencePercent)}</span> : null}
      {item.addedOutsideOrder ? <small className="cl-block">recebido fora do pedido</small> : null}
      {state !== "FINALIZED" ? <small className="cl-block">conferência em andamento</small> : null}
    </>
  );
}

function StoreLines({ journey }: { journey: ProductJourney }) {
  return (
    <div className="cl-detail">
      {journey.destination?.suppliers.length ? (
        <ul className="cl-suppliers" aria-label="Fornecedores">
          {journey.destination.suppliers.map((s) => (
            <li key={s.supplierId}>
              <strong>{s.supplierName} · {qty(s.quantity)} {s.unit}</strong>
              {s.invoices.length ? <span className="cl-muted"> · NF {s.invoices.join(", ")}</span> : <span className="cl-muted"> · sem nota</span>}
              <small className="cl-block">{s.stores.map((st) => `${st.storeName} ${qty(st.quantity)}`).join(" · ")}</small>
            </li>
          ))}
        </ul>
      ) : null}
      {journey.purchase.by ? <p className="cl-muted cl-small">Compra lançada por {journey.purchase.by}.</p> : null}
      {journey.lines.length ? (
        <div className="cl-scroll">
          <table className="cl-table cl-table--inner">
            <thead>
              <tr>
                <th>Loja</th>
                <th>Pedido</th>
                <th>Destinado</th>
                <th className="num">Esperado</th>
                <th className="num">Conferido</th>
                <th className="num">Perdas {LOSS_WINDOW_DAYS} dias</th>
              </tr>
            </thead>
            <tbody>
              {journey.lines.map((line) => (
                <tr key={line.key}>
                  <td>{line.storeName}</td>
                  <td>{line.order ? `${qty(line.order.quantity)} ${line.order.unit}` : <span className="cl-muted">Sem pedido</span>}</td>
                  <td>
                    {line.destinations.length
                      ? line.destinations.map((d) => `${qty(d.quantity)} ${d.unit}`).join(" + ")
                      : <span className="cl-muted">0</span>}
                    {line.cut.situation === "PARTIAL_CUT" || line.cut.situation === "TOTAL_CUT" ? (
                      <span className="cl-text--warn"> {line.cut.difference !== null ? `−${qty(Math.abs(line.cut.difference))} ${line.cut.unit ?? ""}` : "corte"}</span>
                    ) : null}
                    {line.cut.situation === "ADDITIONAL" && line.destinedPositive ? <span className="cl-text--info"> adicional</span> : null}
                  </td>
                  <td className="num">{line.expected.kg !== null ? `${num(line.expected.kg, 1)} kg` : <span className="cl-muted">—</span>}</td>
                  <td className="num"><StoreConference line={line} /></td>
                  <td className="num">
                    {line.lossesAfter
                      ? <span className="cl-text--bad">{[line.lossesAfter.kg > 0 ? `${num(line.lossesAfter.kg, 1)} kg` : null, line.lossesAfter.und > 0 ? `${qty(line.lossesAfter.und)} und` : null].filter(Boolean).join(" + ")}</span>
                      : <span className="cl-muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="cl-muted cl-small">Comprado sem pedido das lojas e sem destinação.</p>
      )}
    </div>
  );
}

function JourneyRow({ journey }: { journey: ProductJourney }) {
  const p = journey.purchase;
  return (
    <details className="cl-row">
      <summary className="cl-row__summary cl-grid--journey">
        <span className="cl-product">
          <strong>{journey.productName}</strong>
          <small>{journey.erpCode}</small>
        </span>
        <Step label="Pedido" main={journey.order ? groupsText(journey.order.groups) : "Sem pedido"} note={journey.order ? `${journey.order.stores} loja(s)` : undefined} tone={journey.order ? undefined : "muted"} />
        <Step
          label="Compra"
          main={p.purchased ? "Comprado" : "Não comprado"}
          note={p.cost !== null ? `${money(p.cost)} / un. de compra` : "sem custo no ciclo"}
          tone={p.purchased ? "ok" : "bad"}
        />
        <Step
          label="Destinação"
          main={journey.destination ? groupsText(journey.destination.groups) : p.purchased ? "Sem destinação" : "—"}
          note={journey.destination ? journey.destination.suppliers.map((s) => s.supplierName).join(", ") : undefined}
          tone={journey.destination ? undefined : p.purchased ? "bad" : "muted"}
        />
        <ConferenceStep journey={journey} />
        <span className="cl-outcome"><OutcomeTags journey={journey} /></span>
      </summary>
      <StoreLines journey={journey} />
    </details>
  );
}

function ProductsTab({ overview }: { overview: ClosingOverview }) {
  const s = overview.summary!;
  const f = overview.filters;
  return (
    <>
      <section className="cl-funnel" aria-label="Resumo do ciclo">
        <div className="cl-card">
          <span className="cl-card__label">1 · Pedido</span>
          <strong>{s.ordered.products} produtos</strong>
          <small>{groupsText(s.ordered.groups) || "—"} · {s.ordered.stores} loja(s)</small>
        </div>
        <div className="cl-card">
          <span className="cl-card__label">2 · Compra</span>
          <strong>{s.purchased.products} comprados</strong>
          <small className={s.purchased.notPurchased ? "cl-text--bad" : undefined}>{s.purchased.notPurchased} pedido(s) e não comprado(s)</small>
        </div>
        <div className="cl-card">
          <span className="cl-card__label">3 · Destinação</span>
          <strong>{s.destined.products} destinados</strong>
          <small className={s.destined.purchasedNotDestined ? "cl-text--bad" : undefined}>{s.destined.purchasedNotDestined} comprado(s) sem destinação</small>
        </div>
        <div className="cl-card">
          <span className="cl-card__label">4 · Conferência</span>
          <strong>{s.conference.storesFinalized} de {s.conference.storesWithDestination} lojas</strong>
          <small className={s.conference.withDifference ? "cl-text--warn" : undefined}>{s.conference.withDifference} com diferença · {s.conference.pending} pendente(s)</small>
        </div>
      </section>

      <div className="cl-toolbar">
        <form method="get" action={BASE_PATH} className="cl-search" role="search">
          {f.cycleDate ? <input type="hidden" name="ciclo" value={f.cycleDate} /> : null}
          {f.storeId ? <input type="hidden" name="loja" value={f.storeId} /> : null}
          {f.filter ? <input type="hidden" name="desfecho" value={f.filter} /> : null}
          <label className="visually-hidden" htmlFor="cl-busca">Buscar produto</label>
          <input id="cl-busca" type="search" name="busca" placeholder="Buscar produto…" defaultValue={f.search ?? ""} />
        </form>
        <nav className="cl-chips" aria-label="Filtrar por desfecho">
          <Link href={href(overview, { desfecho: undefined })} className="cl-chip" aria-current={!f.filter ? "true" : undefined}>Todos {s.total}</Link>
          {JOURNEY_FILTERS.map((key: JourneyFilter) => (
            <Link key={key} href={href(overview, { desfecho: key })} className={`cl-chip cl-chip--${key}`} aria-current={f.filter === key ? "true" : undefined}>
              {JOURNEY_FILTER_LABELS[key]} {s.counts[key]}
            </Link>
          ))}
        </nav>
      </div>

      {overview.journeys.length === 0 ? (
        <p className="cl-empty">Nenhum produto para os filtros escolhidos.</p>
      ) : (
        <div className="cl-list" role="list" aria-label="Produtos do ciclo">
          <div className="cl-list__head cl-grid--journey" aria-hidden="true">
            <span>Produto</span><span>1 · Pedido</span><span>2 · Compra</span><span>3 · Destinação</span><span>4 · Conferência</span><span>Desfecho</span>
          </div>
          {overview.journeys.map((journey) => (
            <div role="listitem" key={journey.productId}><JourneyRow journey={journey} /></div>
          ))}
        </div>
      )}
      <p className="cl-footnote">Toque em um produto para ver loja por loja, fornecedores e notas. Os valores em reais ficam na aba “Valor por loja”.</p>
    </>
  );
}

function ConferenceBadge({ store }: { store: StoreValue }) {
  const c = store.conference;
  if (c.state === "FINALIZED") return <span className="cl-tag cl-tag--ok">Finalizada</span>;
  if (c.state === "IN_PROGRESS") return <span className="cl-tag cl-tag--muted">Em andamento · {c.verifiedItems} de {c.totalItems}</span>;
  if (c.state === "CANCELLED") return <span className="cl-tag cl-tag--muted">Cancelada</span>;
  return <span className="cl-tag cl-tag--muted">Não iniciada</span>;
}

function StoreValueRow({ store }: { store: StoreValue }) {
  return (
    <details className="cl-row">
      <summary className="cl-row__summary cl-grid--values">
        <span className="cl-product"><strong>{store.storeName}</strong><small>{store.products} produto(s)</small></span>
        <Step label="Valor comprado" main={money(store.purchasedValue)} note={store.missingCost ? `${store.missingCost} sem custo` : undefined} />
        <span className="cl-share">
          <span className="cl-step__label">Parte do ciclo</span>
          <span className="cl-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, store.share)}%` }} /></span>
          <small>{num(store.share, 1)}%</small>
        </span>
        <span className="cl-step"><span className="cl-step__label">Conferência</span><ConferenceBadge store={store} /></span>
        <Step label="Valor recebido" main={store.receivedValue === null ? "aguardando" : money(store.receivedValue)} tone={store.receivedValue === null ? "muted" : undefined} />
        <Step
          label="Diferença"
          main={store.difference === null ? "—" : signedMoney(store.difference)}
          note={store.differencePercent === null ? undefined : signedPct(store.differencePercent)}
          tone={moneyTone(store.difference)}
        />
      </summary>
      <div className="cl-detail">
        {store.suppliers.length === 0 ? (
          <p className="cl-muted cl-small">Nada destinado para esta loja no ciclo.</p>
        ) : (
          <div className="cl-scroll">
            <table className="cl-table cl-table--inner">
              <thead>
                <tr>
                  <th>Fornecedor</th>
                  <th>Nota fiscal</th>
                  <th className="num">Produtos</th>
                  <th className="num">Valor comprado</th>
                  <th className="num">Valor recebido</th>
                  <th className="num">Diferença</th>
                </tr>
              </thead>
              <tbody>
                {store.suppliers.map((s) => (
                  <tr key={s.supplierId}>
                    <td>{s.supplierName}</td>
                    <td>{s.invoices.length ? s.invoices.map((n) => `NF ${n}`).join(", ") : <span className="cl-muted">sem nota</span>}</td>
                    <td className="num">{s.products}</td>
                    <td className="num">{money(s.purchasedValue)}</td>
                    <td className="num">{s.receivedValue === null ? <span className="cl-muted">aguardando</span> : money(s.receivedValue)}</td>
                    <td className={`num cl-text--${moneyTone(s.difference)}`}>{s.difference === null ? "—" : signedMoney(s.difference)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </details>
  );
}

function ValuesTab({ overview }: { overview: ClosingOverview }) {
  const v = overview.values!;
  const t = v.totals;
  return (
    <>
      <section className="cl-totals" aria-label="Totais do ciclo">
        <div className="cl-card">
          <span className="cl-card__label">Comprado no ciclo</span>
          <strong className="cl-big">{money(t.purchasedValue)}</strong>
          <small>{v.stores.length} loja(s) · {t.suppliers} fornecedor(es) · {t.products} produto(s)</small>
        </div>
        <div className="cl-card">
          <span className="cl-card__label">Recebido pela conferência</span>
          <strong className="cl-big">{money(t.receivedValue)}</strong>
          <small>{t.storesFinalized} de {v.stores.length} loja(s) com conferência finalizada</small>
        </div>
        <div className={`cl-card${t.difference < 0 ? " cl-card--bad" : ""}`}>
          <span className="cl-card__label">Diferença nas lojas conferidas</span>
          <strong className="cl-big">{t.storesFinalized ? signedMoney(t.difference) : "—"}</strong>
          <small>{t.differencePercent === null ? "Nenhuma loja finalizou a conferência" : `${signedPct(t.differencePercent)} sobre ${money(t.purchasedOfFinalized)} comprados`}</small>
        </div>
      </section>

      {t.missingCost > 0 ? (
        <p className="cl-alert" role="status">{t.missingCost} destinação(ões) sem custo lançado no ciclo ficaram fora do valor.</p>
      ) : null}

      {v.stores.length === 0 ? (
        <p className="cl-empty">Nenhuma loja com pedido ou destinação neste ciclo.</p>
      ) : (
        <div className="cl-list" role="list" aria-label="Valor por loja">
          <div className="cl-list__head cl-grid--values" aria-hidden="true">
            <span>Loja</span><span>Valor comprado</span><span>Parte do ciclo</span><span>Conferência</span><span>Valor recebido</span><span>Diferença</span>
          </div>
          {v.stores.map((store) => (
            <div role="listitem" key={store.storeId}><StoreValueRow store={store} /></div>
          ))}
          <div className="cl-list__total cl-grid--values">
            <strong>Total do ciclo</strong>
            <strong>{money(t.purchasedValue)}</strong>
            <span>100%</span>
            <span>{t.storesFinalized} de {v.stores.length}</span>
            <strong>{money(t.receivedValue)}</strong>
            <strong className={`cl-text--${moneyTone(t.storesFinalized ? t.difference : null)}`}>{t.storesFinalized ? signedMoney(t.difference) : "—"}</strong>
          </div>
        </div>
      )}
      <p className="cl-footnote">
        Valor comprado = quantidade destinada à loja × custo lançado pelo comprador no ciclo. Valor recebido = valor comprado ajustado
        pelo peso da conferência (não recebido conta zero; produto sem pesagem conta o valor comprado). Toque na loja para ver por
        fornecedor e conferir com o total de cada nota.
      </p>
    </>
  );
}

export function ClosingWorkspace({ overview, stores }: { overview: ClosingOverview; stores: Option[] }) {
  const f = overview.filters;
  return (
    <div className="cl-page">
      <header className="cl-header">
        <div>
          <h1 className="cl-title">Fechamento integrado</h1>
          <p className="cl-subtitle">
            {f.tab === "valores"
              ? "Quanto foi comprado para cada loja no ciclo e quanto chegou"
              : "O caminho de cada produto no ciclo: pedido → compra → destinação → conferência"}
          </p>
        </div>
        <form method="get" action={BASE_PATH} className="cl-cycle" aria-label="Ciclo e loja">
          {f.tab === "valores" ? <input type="hidden" name="aba" value="valores" /> : null}
          {overview.previousCycle ? (
            <Link href={href(overview, { ciclo: overview.previousCycle })} className="cl-icon-btn" aria-label="Ciclo anterior">‹</Link>
          ) : <span className="cl-icon-btn" aria-hidden="true">‹</span>}
          <label className="visually-hidden" htmlFor="cl-ciclo">Ciclo de compra</label>
          <select id="cl-ciclo" name="ciclo" defaultValue={f.cycleDate ?? ""}>
            {f.cycleDate && !overview.cycles.includes(f.cycleDate) ? <option value={f.cycleDate}>Compra {dateLabel(f.cycleDate)}</option> : null}
            {overview.cycles.map((c) => <option key={c} value={c}>Compra {dateLabel(c)}</option>)}
          </select>
          {overview.nextCycle ? (
            <Link href={href(overview, { ciclo: overview.nextCycle })} className="cl-icon-btn" aria-label="Próximo ciclo">›</Link>
          ) : <span className="cl-icon-btn" aria-hidden="true">›</span>}
          {f.tab === "produtos" ? (
            <>
              <label className="visually-hidden" htmlFor="cl-loja">Loja</label>
              <select id="cl-loja" name="loja" defaultValue={f.storeId ?? ""}>
                <option value="">Todas as lojas</option>
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </>
          ) : null}
          <button type="submit" className="btn btn--outline">Ver</button>
        </form>
      </header>

      <nav className="cl-tabs" aria-label="Visões do fechamento">
        <Link href={href(overview, { aba: undefined })} aria-current={f.tab === "produtos" ? "page" : undefined}>Caminho dos produtos</Link>
        <Link href={href(overview, { aba: "valores", desfecho: undefined, busca: undefined })} aria-current={f.tab === "valores" ? "page" : undefined}>Valor por loja</Link>
      </nav>

      {!f.cycleDate || !overview.summary ? (
        <p className="cl-empty">Ainda não há ciclos com pedido ou destinação.</p>
      ) : f.tab === "valores" ? (
        <ValuesTab overview={overview} />
      ) : (
        <ProductsTab overview={overview} />
      )}
    </div>
  );
}
