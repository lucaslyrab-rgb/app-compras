"use client";

import { useState, useTransition } from "react";
import { setCycleBoxWeightAction } from "./actions";
import type { BoxWeightInfo } from "./domain";

/** "12.5" → "12,5"; "18" → "18". */
export const formatBoxKg = (value: string | null | undefined) =>
  value === null || value === undefined ? "" : value.replace(".", ",");

/** Etiqueta do peso da caixa no cartão do produto na Destinação. */
export function BoxWeightChip({
  info,
  disabled,
  onOpen,
}: {
  info: BoxWeightInfo;
  disabled: boolean;
  onOpen: () => void;
}) {
  const changed = info.source === "CYCLE" && info.kg !== info.defaultKg;
  const hint =
    info.kg === null
      ? "informar"
      : changed
        ? info.defaultKg
          ? `padrão ${formatBoxKg(info.defaultKg)} kg`
          : "nesta compra"
        : info.source === "SUPPLIER"
          ? "padrão do fornecedor"
          : null;
  const className = `dst-box-weight${changed || info.kg === null ? " dst-box-weight--changed" : ""}`;
  const content = (
    <>
      <span>Caixa</span>
      {info.kg !== null ? <strong>{formatBoxKg(info.kg)} kg</strong> : null}
      {hint ? <small>{hint}</small> : null}
    </>
  );
  if (disabled) return <span className={className}>{content}</span>;
  return (
    <button type="button" className={className} onClick={onOpen} aria-label="Alterar o peso da caixa desta compra">
      {content}
      <em aria-hidden="true">✎</em>
    </button>
  );
}

export type BoxWeightSaved = { weightKg: string; savedAsDefault: boolean };

/** Folha para informar o peso da caixa da compra (vale para todas as lojas do fornecedor). */
export function BoxWeightSheet({
  cycleDate,
  supplierId,
  supplierName,
  productId,
  productName,
  purchaseFormat,
  info,
  stores,
  onClose,
  onSaved,
}: {
  cycleDate: string;
  supplierId: string;
  supplierName: string;
  productId: string;
  productName: string;
  purchaseFormat: string;
  info: BoxWeightInfo;
  /** Lojas com quantidade destinada deste fornecedor (inclui o que ainda não foi salvo). */
  stores: { name: string; quantity: string }[];
  onClose: () => void;
  onSaved: (saved: BoxWeightSaved) => void;
}) {
  const [value, setValue] = useState(formatBoxKg(info.kg));
  const [makeDefault, setMakeDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [, month, day] = cycleDate.split("-");
  const shortcuts = [
    info.defaultKg ? { kg: info.defaultKg, label: info.defaultSource === "SUPPLIER" ? "padrão do fornecedor" : "padrão" } : null,
    info.lastKg && info.lastKg !== info.defaultKg ? { kg: info.lastKg, label: "última compra" } : null,
  ].filter((item): item is { kg: string; label: string } => item !== null);

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await setCycleBoxWeightAction({
        cycleDate,
        supplierId,
        productId,
        weightKg: value,
        makeSupplierDefault: makeDefault,
      });
      if (result.status === "success" && result.data) {
        onSaved({ weightKg: result.data.weightKg, savedAsDefault: result.data.savedAsDefault });
      } else {
        setError(result.message ?? "Não foi possível salvar o peso da caixa.");
      }
    });
  };

  return (
    <div
      className="dst-sheet-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <section className="dst-sheet dst-sheet--compact" role="dialog" aria-modal="true" aria-labelledby="box-weight-title">
        <span className="dst-sheet__grip" aria-hidden="true" />
        <div>
          <h2 id="box-weight-title" className="dst-box-sheet__title">Peso da caixa</h2>
          <span className="dst-subtle">
            {productName} · {supplierName} · compra de {day}/{month}
          </span>
        </div>
        <form
          className="dst-box-sheet__form"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label htmlFor="box-weight-input" className="dst-box-sheet__label">
            Quantos kg tem cada caixa nesta compra?
          </label>
          <div className="dst-box-sheet__input">
            <input
              id="box-weight-input"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              aria-describedby="box-weight-scope"
            />
            <span>kg</span>
          </div>
          {shortcuts.length > 0 ? (
            <div className="dst-box-sheet__chips">
              {shortcuts.map((item) => (
                <button key={item.label} type="button" className="dst-box-sheet__chip" onClick={() => setValue(formatBoxKg(item.kg))}>
                  {formatBoxKg(item.kg)} kg <small>{item.label}</small>
                </button>
              ))}
            </div>
          ) : null}
          <p id="box-weight-scope" className="dst-box-sheet__note">
            Vale para <strong>todas as lojas</strong> que recebem este produto de {supplierName} nesta compra
            {stores.length > 0
              ? `: ${stores.map((s) => `${s.name} (${s.quantity} ${purchaseFormat})`).join(", ")}.`
              : ", inclusive as que você destinar depois."}
          </p>
          {info.supplierLinked ? (
            <label className="dst-box-sheet__check">
              <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />
              <span>Usar este peso como padrão de {supplierName} nas próximas compras</span>
            </label>
          ) : (
            <p className="dst-subtle dst-box-sheet__hint">
              Para guardar um padrão deste fornecedor, vincule-o ao produto no cadastro (aba Fornecedores).
            </p>
          )}
          {error ? (
            <p className="dst-box-sheet__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="dst-box-sheet__actions">
            <button type="button" className="btn btn--secondary" onClick={onClose} disabled={pending}>
              Cancelar
            </button>
            <button type="submit" className="btn" disabled={pending || value.trim() === ""}>
              {pending ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
