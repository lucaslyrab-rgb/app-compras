import Link from "next/link";
import {
  CUT_SITUATIONS,
  CUT_SITUATION_LABELS,
  HIGHLIGHTS,
  HIGHLIGHT_LABELS,
  WEIGHT_RANGE_PERCENT,
  hasAttention,
  weightMessage,
  type CutSituation,
  type Highlight,
  type ReconciliationFilters,
  type ReconciliationKpis,
  type ReconciliationLine,
} from "./domain";
import "./styles.css";

const BASE_PATH = "/fechamento";
const LOAD_MORE_STEP = 50;

type Option = { id: string; name: string };

const qty = (value: number) =>
  value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${qty(Math.abs(value))}`;
const pct = (value: number) =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const cycleLabel = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

function buildQuery(filters: Partial<ReconciliationFilters>, extra: Record<string, string | number | undefined> = {}) {
  const params = new URLSearchParams();
  if (filters.storeId) params.set("storeId", filters.storeId);
  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);
  if (filters.supplierId) params.set("supplierId", filters.supplierId);
  if (filters.search) params.set("search", filters.search);
  if (filters.situation) params.set("situation", filters.situation);
  if (filters.highlight) params.set("highlight", filters.highlight);
  if (filters.onlyAttention === false) params.set("onlyAttention", "0");
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined || value === "") params.delete(key);
    else params.set(key, String(value));
  }
  const qs = params.toString();
  return `${BASE_PATH}${qs ? `?${qs}` : ""}`;
}

const SITUATION_CLASS: Record<CutSituation, string> = {
  INTEGRAL: "rec-tag--integral",
  PARTIAL_CUT: "rec-tag--partial",
  TOTAL_CUT: "rec-tag--total",
  ADDITIONAL: "rec-tag--additional",
  NOT_COMPARABLE: "rec-tag--neutral",
  NONE: "rec-tag--neutral",
};

const HIGHLIGHT_CLASS: Record<Highlight, string> = {
  WEIGHT_OUT_OF_RANGE: "rec-tag--red",
  NOT_RECEIVED: "rec-tag--red",
  RECEIVED_NOT_DESTINED: "rec-tag--blue",
  DESTINED_OUT_OF_CONFERENCE: "rec-tag--blue",
  CONFERENCE_PENDING: "rec-tag--gray",
};

function rowTone(line: ReconciliationLine): "attention" | "info" | null {
  if (line.highlights.includes("WEIGHT_OUT_OF_RANGE") || line.highlights.includes("NOT_RECEIVED")) return "attention";
  if (hasAttention(line)) return "info";
  return null;
}

function OrderCell({ line }: { line: ReconciliationLine }) {
  if (!line.order) return <span className="rec-muted">Sem pedido</span>;
  return (
    <>
      {qty(line.order.quantity)} {line.order.unit}
      <span className="rec-note">
        Revisão {line.order.revision}
        {line.order.unitFromCurrentProduct ? " · unidade atual do produto" : ""}
      </span>
    </>
  );
}

function DestinationCell({ line }: { line: ReconciliationLine }) {
  if (line.destinations.length === 0) {
    return <span className="rec-muted">{line.notPurchased ? "Não comprado" : "Sem destinação"}</span>;
  }
  return (
    <>
      {line.destinations.map((d) => (
        <div key={d.unit}>
          {qty(d.quantity)} {d.unit}
          <span className="rec-note">{d.suppliers.join(", ")}</span>
        </div>
      ))}
    </>
  );
}

function SituationTag({ line }: { line: ReconciliationLine }) {
  const { situation, difference, unit } = line.cut;
  if (situation === "NONE") return <span className="rec-muted">—</span>;
  const detail =
    difference !== null && unit && situation !== "INTEGRAL" ? ` (${signed(difference)} ${unit})` : "";
  return (
    <span className={`rec-tag ${SITUATION_CLASS[situation]}`}>
      {CUT_SITUATION_LABELS[situation]}
      {detail}
    </span>
  );
}

function ExpectedCell({ line }: { line: ReconciliationLine }) {
  const e = line.expected;
  if (e.kg === null) {
    if (e.reason === "NO_DESTINATION") return <span className="rec-muted">—</span>;
    return <span className="rec-muted">{e.reason === "NO_KG_CONVERSION" ? "Sem conversão em kg" : "Sem fator de conversão"}</span>;
  }
  return (
    <>
      {qty(e.kg)} kg
      {e.source === "CURRENT_PRODUCT" ? <span className="rec-note">conversão atual do cadastro</span> : null}
    </>
  );
}

function ConferenceCell({ line }: { line: ReconciliationLine }) {
  const { state, item, revision, revisionDiffers } = line.conference;
  const revisionNote = revisionDiffers && revision !== null ? <span className="rec-note">Conferência sobre a revisão {revision}</span> : null;
  if (state === "NONE") return <span className="rec-muted">Sem conferência</span>;
  if (state === "CANCELLED") return <span className="rec-muted">Conferência cancelada</span>;
  if (!item) return <>{line.destinedPositive ? <span className="rec-muted">Fora da conferência</span> : <span className="rec-muted">—</span>}{revisionNote}</>;
  if (item.isUnreceived) return <><span className="rec-weight rec-weight--OUT_OF_RANGE">Não recebido</span>{revisionNote}</>;
  if (item.weightKg === null) return <><span className="rec-muted">Pendente de pesagem</span>{revisionNote}</>;
  return (
    <>
      <span className={`rec-weight${line.weight ? ` rec-weight--${line.weight.range}` : ""}`}>{qty(item.weightKg)} kg</span>
      {item.removedFromOrder ? <span className="rec-note">removido do pedido vigente</span> : null}
      {revisionNote}
    </>
  );
}

function DifferenceCell({ line }: { line: ReconciliationLine }) {
  if (!line.weight) return <span className="rec-muted">—</span>;
  const message = weightMessage(line.weight);
  return (
    <>
      <span className={`rec-weight rec-weight--${line.weight.range}`}>
        {signed(line.weight.differenceKg)} kg ({pct(line.weight.differencePercent)})
      </span>
      {message ? <span className="rec-message">{message}</span> : null}
    </>
  );
}

function HighlightTags({ line }: { line: ReconciliationLine }) {
  const visible = line.highlights.filter((h) => h !== "WEIGHT_OUT_OF_RANGE");
  if (visible.length === 0) return <span className="rec-muted">—</span>;
  return (
    <div className="rec-tags">
      {visible.map((h) => (
        <span key={h} className={`rec-tag ${HIGHLIGHT_CLASS[h]}`}>{HIGHLIGHT_LABELS[h]}</span>
      ))}
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
  href,
  active,
}: {
  label: string;
  value: number;
  hint: string;
  tone: "red" | "orange" | "green" | "blue" | "gray";
  href: string;
  active: boolean;
}) {
  return (
    <Link href={href} className={`rec-kpi rec-kpi--${tone}`} aria-current={active ? "true" : undefined}>
      <div className="rec-kpi__label">{label}</div>
      <div className="rec-kpi__value">{value.toLocaleString("pt-BR")}</div>
      <div className="rec-kpi__hint">{hint}</div>
    </Link>
  );
}

export function ReconciliationWorkspace({
  stores,
  suppliers,
  filters,
  kpis,
  lines,
  totalMatching,
  pageSize,
  error,
}: {
  stores: Option[];
  suppliers: Option[];
  filters: Partial<ReconciliationFilters>;
  kpis: ReconciliationKpis | null;
  lines: ReconciliationLine[];
  totalMatching: number;
  pageSize: number;
  error?: string;
}) {
  const onlyAttention = filters.onlyAttention !== false;
  const hasMore = totalMatching > lines.length;
  const highlightHref = (h: Highlight) =>
    buildQuery(filters, { highlight: filters.highlight === h ? undefined : h, limit: undefined });

  return (
    <div className="rec-page">
      <header className="rec-header">
        <h1 className="rec-title">📋 Fechamento integrado</h1>
        <p className="rec-subtitle">
          Pedido (CX) × destinação (CX) × conferência (KG) por loja, ciclo e produto. Apenas informativo: nada aqui bloqueia ou altera registros.
        </p>
      </header>

      <form method="get" action={BASE_PATH} className="rec-filters" aria-label="Filtros do fechamento integrado">
        <div className="rec-field">
          <label htmlFor="rec-store">Loja</label>
          <select id="rec-store" name="storeId" defaultValue={filters.storeId ?? ""}>
            <option value="">Todas as lojas ({stores.length})</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="rec-field">
          <label htmlFor="rec-start">Ciclo inicial</label>
          <input id="rec-start" type="date" name="startDate" defaultValue={filters.startDate ?? ""} />
        </div>
        <div className="rec-field">
          <label htmlFor="rec-end">Ciclo final</label>
          <input id="rec-end" type="date" name="endDate" defaultValue={filters.endDate ?? ""} />
        </div>
        <div className="rec-field">
          <label htmlFor="rec-supplier">Fornecedor</label>
          <select id="rec-supplier" name="supplierId" defaultValue={filters.supplierId ?? ""}>
            <option value="">Todos</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="rec-field">
          <label htmlFor="rec-situation">Situação</label>
          <select id="rec-situation" name="situation" defaultValue={filters.situation ?? ""}>
            <option value="">Todas</option>
            {CUT_SITUATIONS.map((s) => <option key={s} value={s}>{CUT_SITUATION_LABELS[s]}</option>)}
          </select>
        </div>
        <div className="rec-field">
          <label htmlFor="rec-highlight">Destaque</label>
          <select id="rec-highlight" name="highlight" defaultValue={filters.highlight ?? ""}>
            <option value="">Todos</option>
            {HIGHLIGHTS.map((h) => <option key={h} value={h}>{HIGHLIGHT_LABELS[h]}</option>)}
          </select>
        </div>
        <div className="rec-field">
          <label htmlFor="rec-search">Produto</label>
          <input id="rec-search" type="search" name="search" placeholder="Nome ou ERP..." defaultValue={filters.search ?? ""} />
        </div>
        <div className="rec-field">
          <label htmlFor="rec-show">Mostrar</label>
          <select id="rec-show" name="onlyAttention" defaultValue={onlyAttention ? "1" : "0"}>
            <option value="1">Somente com destaque</option>
            <option value="0">Todos os itens</option>
          </select>
        </div>
        <div className="rec-actions">
          <button type="submit" className="btn">Filtrar</button>
          <Link href={BASE_PATH} className="btn btn--secondary">Limpar</Link>
        </div>
      </form>

      {error ? <div className="rec-error" role="alert">{error}</div> : null}

      {kpis ? (
        <>
          <section className="rec-kpis" aria-label="Resumo do período">
            <Kpi label="Pesagem fora da faixa" value={kpis.weightOutOfRange} hint={`Mais de ${WEIGHT_RANGE_PERCENT}% acima ou abaixo`} tone="red" href={highlightHref("WEIGHT_OUT_OF_RANGE")} active={filters.highlight === "WEIGHT_OUT_OF_RANGE"} />
            <Kpi label="Não recebidos" value={kpis.notReceived} hint="Destinados e marcados como não recebidos" tone="red" href={highlightHref("NOT_RECEIVED")} active={filters.highlight === "NOT_RECEIVED"} />
            <Kpi label="Fora da conferência" value={kpis.outOfConference} hint="Destinados sem item para pesar" tone="blue" href={highlightHref("DESTINED_OUT_OF_CONFERENCE")} active={filters.highlight === "DESTINED_OUT_OF_CONFERENCE"} />
            <Kpi label="Recebidos sem destinação" value={kpis.receivedNotDestined} hint="Pesados sem destinação no ciclo" tone="blue" href={highlightHref("RECEIVED_NOT_DESTINED")} active={filters.highlight === "RECEIVED_NOT_DESTINED"} />
            <Kpi label="Conferências pendentes" value={kpis.pendingConferences} hint="Loja × ciclo ainda não finalizados" tone="gray" href={highlightHref("CONFERENCE_PENDING")} active={filters.highlight === "CONFERENCE_PENDING"} />
          </section>

          <div className="rec-legend" aria-label="Legenda das cores da pesagem">
            <strong>Pesagem × peso esperado:</strong>
            <span><i className="rec-dot rec-dot--green" aria-hidden="true" /> igual ou até {WEIGHT_RANGE_PERCENT}% acima ({kpis.weightOk})</span>
            <span><i className="rec-dot rec-dot--orange" aria-hidden="true" /> até {WEIGHT_RANGE_PERCENT}% abaixo ({kpis.weightSlightlyBelow})</span>
            <span><i className="rec-dot rec-dot--red" aria-hidden="true" /> mais de {WEIGHT_RANGE_PERCENT}% para mais ou para menos ({kpis.weightOutOfRange})</span>
          </div>
        </>
      ) : null}

      {kpis ? (
        <div className="rec-table-wrap">
          {lines.length === 0 ? (
            <p className="rec-empty">
              {onlyAttention
                ? "Nenhum item com destaque para os filtros selecionados."
                : "Nenhum item encontrado para os filtros selecionados."}
            </p>
          ) : (
            <>
              <table className="rec-table">
                <thead>
                  <tr>
                    <th>Ciclo / Loja</th>
                    <th>Produto</th>
                    <th className="num">Pedido</th>
                    <th className="num">Destinado</th>
                    <th>Situação</th>
                    <th className="num">Esperado</th>
                    <th className="num">Conferido</th>
                    <th className="num">Diferença</th>
                    <th>Destaques</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => {
                    const tone = rowTone(line);
                    return (
                      <tr key={line.key} className={tone ? `rec-row--${tone}` : undefined}>
                        <td>
                          <strong>{cycleLabel(line.cycleDate)}</strong>
                          <span className="rec-note">{line.storeName}</span>
                        </td>
                        <td className="rec-product"><small>[{line.erpCode}]</small> <strong>{line.productName}</strong></td>
                        <td className="num"><OrderCell line={line} /></td>
                        <td className="num"><DestinationCell line={line} /></td>
                        <td><SituationTag line={line} /></td>
                        <td className="num"><ExpectedCell line={line} /></td>
                        <td className="num"><ConferenceCell line={line} /></td>
                        <td className="num"><DifferenceCell line={line} /></td>
                        <td><HighlightTags line={line} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <ul className="rec-cards" aria-label="Itens do fechamento integrado">
                {lines.map((line) => {
                  const tone = rowTone(line);
                  return (
                    <li key={line.key} className={`rec-card${tone ? ` rec-card--${tone}` : ""}`} style={{ listStyle: "none" }}>
                      <div className="rec-card__head">
                        <span>{cycleLabel(line.cycleDate)} · {line.storeName}</span>
                        <SituationTag line={line} />
                      </div>
                      <div className="rec-product"><small>[{line.erpCode}]</small> <strong>{line.productName}</strong></div>
                      <dl className="rec-card__grid">
                        <div><dt>Pedido</dt><dd><OrderCell line={line} /></dd></div>
                        <div><dt>Destinado</dt><dd><DestinationCell line={line} /></dd></div>
                        <div><dt>Esperado</dt><dd><ExpectedCell line={line} /></dd></div>
                        <div><dt>Conferido</dt><dd><ConferenceCell line={line} /></dd></div>
                        <div style={{ gridColumn: "1 / -1" }}><dt>Diferença</dt><dd><DifferenceCell line={line} /></dd></div>
                      </dl>
                      {line.highlights.some((h) => h !== "WEIGHT_OUT_OF_RANGE") ? (
                        <div style={{ marginTop: 8 }}><HighlightTags line={line} /></div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {lines.length > 0 ? (
            <div className="rec-footer">
              <span>Exibindo {lines.length} de {totalMatching} item(ns) no filtro.</span>
              {hasMore ? (
                <Link href={buildQuery(filters, { limit: pageSize + LOAD_MORE_STEP })} className="btn btn--secondary">Carregar mais</Link>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
