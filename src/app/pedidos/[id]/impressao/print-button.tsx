"use client";

export function OrderPrintButton({
  label = "Imprimir / Salvar PDF",
  className = "btn",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <button className={className} type="button" onClick={() => window.print()}>
      {label}
    </button>
  );
}
