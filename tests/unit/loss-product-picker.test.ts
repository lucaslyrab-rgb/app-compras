// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { LossProductPicker, filterLossProducts } from "@/modules/purchasing/losses/loss-product-picker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => React.createElement("img", props),
}));

const products = [
  { id: "tomate", erpCode: 169, name: "TOMATE KG", unit: "KG" },
  { id: "abacate", erpCode: 1, name: "ABACATE KG", unit: "KG" },
  { id: "mamao", erpCode: 210, name: "MAMÃO FORMOSA", unit: "KG" },
];

describe("Perdas — escolha do produto", () => {
  it("ordena de A a Z e busca por nome sem acento ou código ERP", () => {
    expect(filterLossProducts(products, "").map((p) => p.id)).toEqual(["abacate", "mamao", "tomate"]);
    expect(filterLossProducts(products, "mamao").map((p) => p.id)).toEqual(["mamao"]);
    expect(filterLossProducts(products, "169").map((p) => p.id)).toEqual(["tomate"]);
  });

  it("mostra os que chegaram na última compra e devolve o produto tocado", async () => {
    const onSelect = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        React.createElement(LossProductPicker, {
          products,
          recentProductIds: ["tomate", "inexistente"],
          selectedProduct: null,
          onSelect,
        }),
      ),
    );

    expect(container.textContent).toContain("Escolher produto");
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());

    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Chegaram na última compra");
    expect(dialog.querySelectorAll(".loss-picker-tile")).toHaveLength(1);

    await act(async () => dialog.querySelector<HTMLButtonElement>(".loss-picker-tile")!.click());
    expect(onSelect).toHaveBeenCalledWith("tomate");
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });
});
