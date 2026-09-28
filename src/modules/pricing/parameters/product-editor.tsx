"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatPricingNumber } from "../analysis/domain";
import { createProductAction, saveProductPricingAction } from "./actions";
import type { PricingProduct, PricingSettings } from "./domain";

type Props = {
  product?: PricingProduct;
  settings: PricingSettings;
  onSaved?: (product: PricingProduct) => void;
  onCreated?: (product: PricingProduct) => void;
  onCancel?: () => void;
};

export function ProductPricingEditor({ product, settings, onSaved, onCreated, onCancel }: Props) {
  const router = useRouter();
  const [erpCode, setErpCode] = useState(product ? String(product.erpCode) : "");
  const [name, setName] = useState(product?.name ?? "");
  const [catalogUnit, setCatalogUnit] = useState(product?.catalogUnit ?? "KG");
  const [purchaseFormat, setPurchaseFormat] = useState(product?.purchaseFormat ?? "CX");
  const [exclusiveSupplier, setExclusiveSupplier] = useState(product?.exclusiveSupplier ?? false);
  const [saleUnit, setSaleUnit] = useState(product?.saleUnit ?? "KG");
  const [conversion, setConversion] = useState(product ? formatPricingNumber(product.conversionQuantity) : "1");
  const [loss, setLoss] = useState(product ? formatPricingNumber(product.beneficiationLossPercent) : "0");
  const [specific, setSpecific] = useState(product?.specificMarginPercent !== null && product !== undefined);
  const [margin, setMargin] = useState(product?.specificMarginPercent ? formatPricingNumber(product.specificMarginPercent) : formatPricingNumber(settings.defaultMarginPercent));
  const [version, setVersion] = useState(product?.version ?? 1);
  const [productVersion, setProductVersion] = useState(product?.productVersion ?? 1);
  const [confirmedFormatConversion, setConfirmedFormatConversion] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const formatChanged = Boolean(product && purchaseFormat.trim().toLocaleUpperCase("pt-BR") !== product.purchaseFormat);

  function load(current: PricingProduct) {
    setErpCode(String(current.erpCode));
    setName(current.name);
    setCatalogUnit(current.catalogUnit);
    setPurchaseFormat(current.purchaseFormat);
    setExclusiveSupplier(current.exclusiveSupplier);
    setSaleUnit(current.saleUnit);
    setConversion(formatPricingNumber(current.conversionQuantity));
    setLoss(formatPricingNumber(current.beneficiationLossPercent));
    setSpecific(current.specificMarginPercent !== null);
    setMargin(formatPricingNumber(current.specificMarginPercent ?? settings.defaultMarginPercent));
    setVersion(current.version);
    setProductVersion(current.productVersion);
    setConfirmedFormatConversion(false);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const fields = {
        erpCode: Number(erpCode),
        name: name.trim(),
        catalogUnit: catalogUnit.trim(),
        purchaseFormat: purchaseFormat.trim(),
        exclusiveSupplier,
        saleUnit: saleUnit.trim(),
        conversionQuantity: conversion,
        beneficiationLossPercent: loss,
        specificMarginPercent: specific ? margin : null,
      };
      const result = product
        ? await saveProductPricingAction({ productId: product.id, ...fields, expectedVersion: version, expectedProductVersion: productVersion, confirmedFormatConversion })
        : await createProductAction(fields);
      if (result.status === "success") {
        load(result.value);
        setFeedback({ error: false, message: product ? "Alterações salvas." : "Produto cadastrado." });
        if (product) {
          router.refresh();
          onSaved?.(result.value);
        } else if (onCreated) {
          onCreated(result.value);
        } else {
          router.push(`/gestor/produtos/${result.value.id}`);
        }
      } else {
        if (result.status === "conflict") {
          load(result.value);
          onSaved?.(result.value);
        }
        setFeedback({ error: true, message: result.message });
      }
    });
  }

  const status = product?.conversionOrigin === "PROVISIONAL" ? "Conversão padrão" : product?.conversionOrigin === "UNIT" ? "Unitário" : "Configurado";
  const displayTitle = product ? product.name : (name.trim() || "Novo produto");
  const displayErp = product ? `ERP: ${erpCode || product.erpCode}` : erpCode ? `ERP: ${erpCode}` : "Cadastro mestre e precificação inicial";

  return <section className="manager-editor" aria-label={product ? `Editar ${product.name}` : "Cadastrar novo produto"}>
    <header className="manager-editor__title">
      <div className="manager-product-identity">
        <span className="manager-placeholder" aria-hidden="true">◌</span>
        <div>
          <h2>{displayTitle}</h2>
          <p>{displayErp}</p>
        </div>
      </div>
      {product ? <span className={`manager-badge manager-badge--${product.conversionOrigin.toLowerCase()}`}>{status}</span> : null}
    </header>
    <form className="manager-form" onSubmit={submit}>
      <fieldset className="manager-form-section">
        <legend>Dados do produto</legend>
        <div className="manager-form-grid">
          <label htmlFor="product-erp-code">
            <span>Código ERP</span>
            <input
              id="product-erp-code"
              name="erpCode"
              type="number"
              min="1"
              required
              placeholder="Ex.: 1234"
              value={erpCode}
              onChange={(event) => setErpCode(event.target.value)}
            />
          </label>
          <label htmlFor="product-name">
            <span>Nome</span>
            <input
              id="product-name"
              name="name"
              type="text"
              required
              minLength={2}
              maxLength={200}
              autoComplete="off"
              placeholder="Nome do produto"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        </div>
        <div className="manager-form-grid">
          <label htmlFor="product-catalog-unit">
            <span>Unidade do catálogo/pedido</span>
            <input
              id="product-catalog-unit"
              name="catalogUnit"
              type="text"
              required
              maxLength={16}
              autoComplete="off"
              placeholder="Ex.: KG, CX, UND"
              value={catalogUnit}
              onChange={(event) => setCatalogUnit(event.target.value)}
            />
          </label>
          <label htmlFor="product-purchase-format">
            <span>Formato de compra</span>
            <input
              id="product-purchase-format"
              name="purchaseFormat"
              type="text"
              required
              maxLength={16}
              autoComplete="off"
              placeholder="Ex.: CX, SAC, BDJ"
              value={purchaseFormat}
              onChange={(event) => {
                setPurchaseFormat(event.target.value);
                setConfirmedFormatConversion(false);
              }}
            />
          </label>
        </div>
        <label className="manager-check" htmlFor="product-exclusive-supplier">
          <input
            id="product-exclusive-supplier"
            name="exclusiveSupplier"
            type="checkbox"
            checked={exclusiveSupplier}
            onChange={(event) => setExclusiveSupplier(event.target.checked)}
          />
          Fornecedor exclusivo
        </label>
      </fieldset>
      <fieldset className="manager-form-section">
        <legend>Parâmetros de precificação</legend>
        <div className="manager-form-grid">
          <label htmlFor="product-sale-unit">
            <span>Unidade de venda</span>
            <input
              id="product-sale-unit"
              name="saleUnit"
              type="text"
              required
              maxLength={16}
              autoComplete="off"
              value={saleUnit}
              onChange={(event) => setSaleUnit(event.target.value)}
            />
          </label>
          <label htmlFor="product-conversion">
            <span>Quantidade de conversão</span>
            <span className="manager-input-group">
              <input
                id="product-conversion"
                name="conversionQuantity"
                required
                inputMode="decimal"
                value={conversion}
                onChange={(event) => setConversion(event.target.value)}
              />
              <em>{saleUnit}</em>
            </span>
          </label>
        </div>
        {formatChanged ? (
          <label className="manager-confirmation" htmlFor="product-confirm-conversion">
            <input
              id="product-confirm-conversion"
              name="confirmConversion"
              type="checkbox"
              required
              checked={confirmedFormatConversion}
              onChange={(event) => setConfirmedFormatConversion(event.target.checked)}
            />
            Revisei e confirmo a conversão para o novo formato de compra.
          </label>
        ) : null}
        <label htmlFor="product-loss">
          <span>Perda média de beneficiamento</span>
          <span className="manager-input-group">
            <input
              id="product-loss"
              name="beneficiationLossPercent"
              required
              inputMode="decimal"
              value={loss}
              onChange={(event) => setLoss(event.target.value)}
            />
            <em>%</em>
          </span>
        </label>
        <fieldset className="manager-margin-options">
          <legend>Margem</legend>
          <label>
            <input type="radio" name="margin-origin" checked={!specific} onChange={() => setSpecific(false)} />
            Usar margem padrão do FLV ({formatPricingNumber(settings.defaultMarginPercent)}%)
          </label>
          <label>
            <input type="radio" name="margin-origin" checked={specific} onChange={() => setSpecific(true)} />
            Margem específica{" "}
            <span className="manager-input-group">
              <input
                aria-label="Margem específica"
                inputMode="decimal"
                disabled={!specific}
                value={margin}
                onChange={(event) => setMargin(event.target.value)}
              />
              <em>%</em>
            </span>
          </label>
        </fieldset>
      </fieldset>
      {feedback ? <p role="status" className={feedback.error ? "manager-feedback manager-feedback--error" : "manager-feedback manager-feedback--success"}>{feedback.message}</p> : null}
      <div className="manager-form-actions">
        {onCancel ? <button type="button" className="manager-secondary" onClick={onCancel}>Cancelar</button> : null}
        <button className="manager-primary" disabled={pending}>{pending ? "Salvando…" : product ? "Salvar alterações" : "Cadastrar produto"}</button>
      </div>
    </form>
  </section>;
}
