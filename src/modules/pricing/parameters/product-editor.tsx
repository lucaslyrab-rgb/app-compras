"use client";

import { useState, useTransition } from "react";
import { formatPricingNumber } from "../analysis/domain";
import { saveProductPricingAction } from "./actions";
import type { PricingProduct, PricingSettings } from "./domain";

export function ProductPricingEditor({ product, settings, onSaved }: { product: PricingProduct; settings: PricingSettings; onSaved?: (product: PricingProduct) => void }) {
  const [saleUnit, setSaleUnit] = useState(product.saleUnit);
  const [conversion, setConversion] = useState(formatPricingNumber(product.conversionQuantity));
  const [loss, setLoss] = useState(formatPricingNumber(product.beneficiationLossPercent));
  const [specific, setSpecific] = useState(product.specificMarginPercent !== null);
  const [margin, setMargin] = useState(product.specificMarginPercent ? formatPricingNumber(product.specificMarginPercent) : formatPricingNumber(settings.defaultMarginPercent));
  const [version, setVersion] = useState(product.version);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveProductPricingAction({ productId: product.id, saleUnit, conversionQuantity: conversion, beneficiationLossPercent: loss, specificMarginPercent: specific ? margin : null, expectedVersion: version });
      if (result.status === "success") {
        setVersion(result.value.version);
        setFeedback({ error: false, message: "Alterações salvas." });
        onSaved?.(result.value);
      } else {
        if (result.status === "conflict") {
          setSaleUnit(result.value.saleUnit);
          setConversion(formatPricingNumber(result.value.conversionQuantity));
          setLoss(formatPricingNumber(result.value.beneficiationLossPercent));
          setSpecific(result.value.specificMarginPercent !== null);
          setMargin(formatPricingNumber(result.value.specificMarginPercent ?? settings.defaultMarginPercent));
          setVersion(result.value.version);
          onSaved?.(result.value);
        }
        setFeedback({ error: true, message: result.message });
      }
    });
  }

  const status = product.conversionOrigin === "PROVISIONAL" ? "Conversão padrão" : product.conversionOrigin === "UNIT" ? "Unitário" : "Configurado";
  return <section className="manager-editor" aria-label={`Editar ${product.name}`}>
    <header className="manager-editor__title"><div className="manager-product-identity"><span className="manager-placeholder" aria-hidden="true">◌</span><div><h2>{product.name}</h2><p>ERP: {product.erpCode}</p></div></div><span className={`manager-badge manager-badge--${product.conversionOrigin.toLowerCase()}`}>{status}</span></header>
    <form className="manager-form" onSubmit={submit}>
      <div className="manager-form-grid"><label><span>Formato de compra</span><input value={product.purchaseFormat} readOnly /></label><label><span>Unidade de venda</span><input value={saleUnit} onChange={(event) => setSaleUnit(event.target.value)} maxLength={16} /></label></div>
      <label><span>Conversão</span><span className="manager-input-group"><b>1 {product.purchaseFormat} =</b><input inputMode="decimal" value={conversion} onChange={(event) => setConversion(event.target.value)} /><em>{saleUnit}</em></span></label>
      <label><span>Perda média de beneficiamento</span><span className="manager-input-group"><input inputMode="decimal" value={loss} onChange={(event) => setLoss(event.target.value)} /><em>%</em></span></label>
      <fieldset className="manager-margin-options"><legend>Margem</legend><label><input type="radio" checked={!specific} onChange={() => setSpecific(false)} /> Usar margem padrão do FLV ({formatPricingNumber(settings.defaultMarginPercent)}%)</label><label><input type="radio" checked={specific} onChange={() => setSpecific(true)} /> Margem específica <span className="manager-input-group"><input aria-label="Margem específica" inputMode="decimal" disabled={!specific} value={margin} onChange={(event) => setMargin(event.target.value)} /><em>%</em></span></label></fieldset>
      {feedback ? <p role="status" className={feedback.error ? "manager-feedback manager-feedback--error" : "manager-feedback manager-feedback--success"}>{feedback.message}</p> : null}
      <div className="manager-form-actions"><button className="manager-primary" disabled={pending}>{pending ? "Salvando…" : "Salvar alterações"}</button></div>
    </form>
  </section>;
}
