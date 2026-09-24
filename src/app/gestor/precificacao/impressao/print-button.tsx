"use client";

export function PrintPricingButton() {
  return <button type="button" className="manager-primary no-print" onClick={() => window.print()}>Imprimir</button>;
}
