"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  buildChargeText,
  chargeableItems,
  type InvoiceRef,
  type StoreSupplierInvoices,
  type SupplierItemValue,
  type SupplierValue,
} from "./closing";
import {
  informInvoiceNumberAction,
  removeInformedInvoiceNumberAction,
  setInvoiceEntryAction,
} from "./closing-actions";

const dateLabel = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

// ---------------------------------------------------------------------------
// Ciclo e loja: o seletor acompanha as setas e troca a tela ao escolher.
// ---------------------------------------------------------------------------

export function ClosingFilterBar(props: {
  basePath: string;
  params: Record<string, string>;
  cycleDate: string | null;
  cycles: string[];
  previousHref: string | null;
  nextHref: string | null;
  showStore: boolean;
  storeId: string | null;
  stores: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const go = (changes: Record<string, string | null>) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...props.params, ...changes })) if (value) query.set(key, value);
    const qs = query.toString();
    startTransition(() => router.push(`${props.basePath}${qs ? `?${qs}` : ""}`));
  };

  const cycleOptions = props.cycleDate && !props.cycles.includes(props.cycleDate) ? [props.cycleDate, ...props.cycles] : props.cycles;

  return (
    <div className="cl-cycle" aria-busy={pending || undefined}>
      {props.previousHref ? (
        <Link href={props.previousHref} className="cl-icon-btn" aria-label="Ciclo anterior">‹</Link>
      ) : <span className="cl-icon-btn" aria-hidden="true">‹</span>}
      <label className="visually-hidden" htmlFor="cl-ciclo">Ciclo de compra</label>
      <select id="cl-ciclo" value={props.cycleDate ?? ""} onChange={(e) => go({ ciclo: e.target.value })} disabled={pending}>
        {cycleOptions.map((c) => <option key={c} value={c}>Compra {dateLabel(c)}</option>)}
      </select>
      {props.nextHref ? (
        <Link href={props.nextHref} className="cl-icon-btn" aria-label="Próximo ciclo">›</Link>
      ) : <span className="cl-icon-btn" aria-hidden="true">›</span>}
      {props.showStore ? (
        <>
          <label className="visually-hidden" htmlFor="cl-loja">Loja</label>
          <select id="cl-loja" value={props.storeId ?? ""} onChange={(e) => go({ loja: e.target.value || null })} disabled={pending}>
            <option value="">Todas as lojas</option>
            {props.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </>
      ) : null}
      {pending ? <span className="cl-loading" role="status">Carregando…</span> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notas: número (abre a foto), "entrada dada" e número informado sem foto.
// ---------------------------------------------------------------------------

type Key = { cycleDate: string; storeId: string; supplierId: string; invoiceNumber: string };

function EntryCheckbox({ invoice, cycleDate, onError }: { invoice: InvoiceRef; cycleDate: string; onError: (m: string | null) => void }) {
  const router = useRouter();
  const [checked, setChecked] = useState(Boolean(invoice.entryConfirmedAt));
  const [pending, startTransition] = useTransition();

  const toggle = (next: boolean) => {
    setChecked(next);
    onError(null);
    startTransition(async () => {
      const result = await setInvoiceEntryAction({
        cycleDate, storeId: invoice.storeId, supplierId: invoice.supplierId, invoiceNumber: invoice.number, confirmed: next,
      });
      if (result.status === "error") {
        setChecked(!next);
        onError(result.message);
      } else {
        router.refresh();
      }
    });
  };

  return (
    <label className={`cl-entry${checked ? " cl-entry--done" : ""}`}>
      <input type="checkbox" checked={checked} disabled={pending} onChange={(e) => toggle(e.target.checked)} />
      Entrada dada
      {checked && invoice.entryConfirmedAt ? (
        <small>{invoice.entryConfirmedBy ?? "—"} · {invoice.entryConfirmedAt}</small>
      ) : null}
    </label>
  );
}

function PhotoDialog({ invoice, cycleDate, supplierName, onClose }: { invoice: InvoiceRef; cycleDate: string; supplierName: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => closeRef.current?.focus(), []);
  const src = `/api/invoices/${invoice.invoiceId}/image`;
  return (
    <div className="cl-dialog__backdrop" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`nota-${invoice.invoiceId}`}
        className="cl-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
      >
        <header className="cl-dialog__head">
          <div>
            <h2 id={`nota-${invoice.invoiceId}`}>NF {invoice.number} · {supplierName}</h2>
            <span>Compra {dateLabel(cycleDate)}</span>
          </div>
          <button ref={closeRef} type="button" className="cl-icon-btn" aria-label="Fechar" onClick={onClose}>×</button>
        </header>
        <div className="cl-dialog__photo">
          <Image src={src} alt={`Foto da nota fiscal ${invoice.number}`} width={900} height={1200} unoptimized />
        </div>
        <footer className="cl-dialog__foot">
          <EntryCheckbox key={invoice.entryConfirmedAt ?? "pendente"} invoice={invoice} cycleDate={cycleDate} onError={setError} />
          <a href={src} target="_blank" rel="noopener noreferrer">Abrir foto em tamanho real</a>
        </footer>
        {error ? <p className="cl-error" role="alert">{error}</p> : null}
      </div>
    </div>
  );
}

function InvoiceLine({ invoice, cycleDate, supplierName }: { invoice: InvoiceRef; cycleDate: string; supplierName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, startRemoving] = useTransition();

  const remove = () => {
    setError(null);
    startRemoving(async () => {
      const result = await removeInformedInvoiceNumberAction({
        cycleDate, storeId: invoice.storeId, supplierId: invoice.supplierId, invoiceNumber: invoice.number,
      } satisfies Key);
      if (result.status === "error") setError(result.message);
      else router.refresh();
    });
  };

  return (
    <div className="cl-invoice">
      <span className="cl-invoice__row">
        {invoice.invoiceId ? (
          <button type="button" className="cl-invoice__number" onClick={() => setOpen(true)}>NF {invoice.number}</button>
        ) : (
          <span className="cl-invoice__number cl-invoice__number--plain">
            NF {invoice.number} <small>sem foto</small>
            {!invoice.entryConfirmedAt ? (
              <button type="button" className="cl-invoice__remove" aria-label={`Remover número ${invoice.number}`} onClick={remove} disabled={removing}>×</button>
            ) : null}
          </span>
        )}
        <EntryCheckbox key={invoice.entryConfirmedAt ?? "pendente"} invoice={invoice} cycleDate={cycleDate} onError={setError} />
      </span>
      {error ? <span className="cl-error" role="alert">{error}</span> : null}
      {open && invoice.invoiceId ? (
        <PhotoDialog invoice={invoice} cycleDate={cycleDate} supplierName={supplierName} onClose={() => setOpen(false)} />
      ) : null}
    </div>
  );
}

function InformNumber({ cycleDate, storeId, supplierId }: { cycleDate: string; storeId: string; supplierId: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = `nf-${storeId}-${supplierId}`;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setMessage(null);
    startTransition(async () => {
      const result = await informInvoiceNumberAction({ cycleDate, storeId, supplierId, invoiceNumber: value });
      if (result.status === "error") setMessage(result.message);
      else {
        setValue("");
        if (result.message) setMessage(result.message);
        router.refresh();
      }
    });
  };

  return (
    <form className="cl-inform" onSubmit={save}>
      <label className="visually-hidden" htmlFor={id}>Número da nota</label>
      <input id={id} type="text" inputMode="numeric" placeholder="Nº da nota (sem foto)" value={value} maxLength={100} onChange={(e) => setValue(e.target.value)} />
      <button type="submit" className="btn btn--outline" disabled={pending || !value.trim()}>Salvar</button>
      {message ? <span className="cl-error" role="status">{message}</span> : null}
    </form>
  );
}

/** Notas de uma loja para os fornecedores de um produto (ou de uma linha de fornecedor). */
export function InvoiceCell({
  cycleDate,
  storeId,
  suppliers,
  allowInform = true,
}: {
  cycleDate: string;
  storeId: string;
  suppliers: StoreSupplierInvoices[];
  allowInform?: boolean;
}) {
  if (suppliers.length === 0) return <span className="cl-muted">—</span>;
  const many = suppliers.length > 1;
  return (
    <div className="cl-invoices">
      {suppliers.map((s) => (
        <div key={s.supplierId} className="cl-invoices__supplier">
          {many ? <small className="cl-muted">{s.supplierName}</small> : null}
          {s.invoices.map((inv) => (
            <InvoiceLine key={inv.number} invoice={inv} cycleDate={cycleDate} supplierName={s.supplierName} />
          ))}
          {s.invoices.length === 0 ? (
            allowInform ? <InformNumber cycleDate={cycleDate} storeId={storeId} supplierId={s.supplierId} /> : <span className="cl-muted">sem nota</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Valor por loja: itens de cada nota (loja × fornecedor) e texto de cobrança.
// ---------------------------------------------------------------------------

const brNum = (value: number, digits = 2) =>
  value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const brQty = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const brMoney = (value: number) => `R$ ${brNum(value)}`;
const brSigned = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}R$ ${brNum(Math.abs(value))}`;
const tone = (value: number | null) => (value === null ? "muted" : value < 0 ? "bad" : "ok");

function ItemStatus({ item }: { item: SupplierItemValue }) {
  if (item.status === "UNRECEIVED") return <span className="cl-tag cl-tag--bad cl-items__tag">Não recebido</span>;
  if (item.status === "NO_WEIGHT") return <span className="cl-tag cl-tag--muted cl-items__tag">sem pesagem</span>;
  if (item.status === "PENDING") return <span className="cl-tag cl-tag--muted cl-items__tag">conferência pendente</span>;
  if (item.weightPercent !== null && item.weightPercent < 0) {
    return <span className="cl-tag cl-tag--bad cl-items__tag">−{brNum(Math.abs(item.weightPercent), 1)}%</span>;
  }
  return null;
}

function conferredText(item: SupplierItemValue) {
  if (item.status === "UNRECEIVED") return "0";
  if (item.status === "WEIGHED" && item.conferredKg !== null) return `${brNum(item.conferredKg, 1)} kg`;
  if (item.status === "NO_WEIGHT") return "recebido";
  return "—";
}

function SupplierItems({
  supplier,
  storeName,
  cycleDate,
}: {
  supplier: SupplierValue;
  storeName: string;
  cycleDate: string;
}) {
  const [copied, setCopied] = useState<"ok" | "error" | null>(null);
  const charge = buildChargeText({
    supplierName: supplier.supplierName,
    storeName,
    cycleDate,
    invoiceNumbers: supplier.invoices.map((inv) => inv.number),
    items: supplier.items,
  });
  const manual = supplier.items.filter((item) => item.multipleSuppliers);
  const chargeCount = chargeableItems(supplier.items).length;
  const nf = supplier.invoices.length ? `NF ${supplier.invoices.map((inv) => inv.number).join(", ")}` : "sem nota";

  const copy = async () => {
    if (!charge) return;
    try {
      await navigator.clipboard.writeText(charge);
      setCopied("ok");
    } catch {
      setCopied("error");
    }
  };

  return (
    <div className="cl-items">
      <div className="cl-items__head">
        <strong>
          Itens de {supplier.supplierName} para {storeName} — {nf} · compra de {dateLabel(cycleDate).slice(0, 5)}
        </strong>
        {charge ? (
          <button type="button" className="btn cl-items__copy" onClick={copy}>
            {copied === "ok" ? "Cobrança copiada ✓" : `Copiar cobrança (${chargeCount})`}
          </button>
        ) : null}
      </div>
      {copied === "error" ? (
        <p className="cl-error" role="alert">Não foi possível copiar. Selecione o texto abaixo e copie manualmente.</p>
      ) : null}
      {manual.length > 0 ? (
        <p className="cl-items__warn" role="note">
          ⚠ {manual.map((item) => item.productName).join(", ")} veio de mais de um fornecedor para esta loja. A
          pesagem é do produto inteiro, então os valores abaixo são divididos na proporção destinada e o item fica
          fora da cobrança. Confira manualmente.
        </p>
      ) : null}
      <div className="cl-scroll">
        <table className="cl-table cl-table--items">
          <thead>
            <tr>
              <th>Produto</th>
              <th className="num">Destinado</th>
              <th className="num">Esperado</th>
              <th className="num">Conferido</th>
              <th className="num">Custo</th>
              <th className="num">Valor comprado</th>
              <th className="num">Valor recebido</th>
              <th className="num">Diferença</th>
            </tr>
          </thead>
          <tbody>
            {supplier.items.map((item) => (
              <tr key={item.productId} className={item.difference !== null && item.difference < -0.004 ? "cl-items__short" : undefined}>
                <td>
                  <span className="cl-items__name">{item.productName}</span>
                  <ItemStatus item={item} />
                  {item.multipleSuppliers ? <span className="cl-tag cl-tag--warn cl-items__tag">vários fornecedores</span> : null}
                  <small className="cl-muted cl-items__erp">
                    ERP {item.erpCode}
                    {item.boxWeightKg !== null ? ` · caixa de ${brNum(item.boxWeightKg, item.boxWeightKg % 1 === 0 ? 0 : 1)} kg` : ""}
                  </small>
                </td>
                <td className="num">{item.destined.map((g) => `${brQty(g.quantity)} ${g.unit}`).join(" + ")}</td>
                <td className="num">{item.expectedKg === null ? "—" : `${brNum(item.expectedKg, 1)} kg`}</td>
                <td className="num">{conferredText(item)}</td>
                <td className="num">{item.cost === null ? <span className="cl-muted">sem custo</span> : brMoney(item.cost)}</td>
                <td className="num">{brMoney(item.purchasedValue)}</td>
                <td className="num">{item.receivedValue === null ? <span className="cl-muted">aguardando</span> : brMoney(item.receivedValue)}</td>
                <td className={`num cl-text--${tone(item.difference)}`}>{item.difference === null ? "—" : brSigned(item.difference)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}>Total da nota</td>
              <td className="num">{brMoney(supplier.purchasedValue)}</td>
              <td className="num">{supplier.receivedValue === null ? "—" : brMoney(supplier.receivedValue)}</td>
              <td className={`num cl-text--${tone(supplier.difference)}`}>{supplier.difference === null ? "—" : brSigned(supplier.difference)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {charge ? (
        <details className="cl-items__charge">
          <summary>Ver texto da cobrança</summary>
          <pre>{charge}</pre>
          <small className="cl-muted">Lista só o que faltou; sobras não abatem.</small>
        </details>
      ) : supplier.receivedValue !== null ? (
        <p className="cl-muted cl-small">Nenhuma falta para cobrar nesta nota.</p>
      ) : null}
    </div>
  );
}

/** Linha de um fornecedor no Valor por loja; o botão de itens abre a nota produto a produto. */
export function SupplierValueRow({
  supplier,
  storeId,
  storeName,
  cycleDate,
}: {
  supplier: SupplierValue;
  storeId: string;
  storeName: string;
  cycleDate: string;
}) {
  const [open, setOpen] = useState(false);
  const detailId = `itens-${storeId}-${supplier.supplierId}`;
  const label = `${supplier.products} ${supplier.products === 1 ? "item" : "itens"}`;
  return (
    <>
      <tr className={open ? "cl-items__open" : undefined}>
        <td>{open ? <strong>{supplier.supplierName}</strong> : supplier.supplierName}</td>
        <td className="cl-invoice-col">
          <InvoiceCell
            cycleDate={cycleDate}
            storeId={storeId}
            suppliers={[{ supplierId: supplier.supplierId, supplierName: supplier.supplierName, invoices: supplier.invoices }]}
            allowInform={false}
          />
        </td>
        <td className="num">
          <button
            type="button"
            className="cl-items__toggle"
            aria-expanded={open}
            aria-controls={detailId}
            onClick={() => setOpen((value) => !value)}
          >
            {label} {open ? "▾" : "▸"}
          </button>
        </td>
        <td className="num">{brMoney(supplier.purchasedValue)}</td>
        <td className="num">{supplier.receivedValue === null ? <span className="cl-muted">aguardando</span> : brMoney(supplier.receivedValue)}</td>
        <td className={`num cl-text--${tone(supplier.difference)}`}>{supplier.difference === null ? "—" : brSigned(supplier.difference)}</td>
      </tr>
      {open ? (
        <tr className="cl-items__detail" id={detailId}>
          <td colSpan={6}>
            <SupplierItems supplier={supplier} storeName={storeName} cycleDate={cycleDate} />
          </td>
        </tr>
      ) : null}
    </>
  );
}
