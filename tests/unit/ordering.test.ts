import { describe, expect, it } from "vitest";
import { conferenceItems, nextRevision, validateDraft } from "@/modules/ordering/domain";

const productId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

describe("pedidos", () => {
  it("valida quantidades não negativas", () => {
    expect(validateDraft([{ productId, stock: 1, quantity: 2 }])).toHaveLength(1);
    expect(() => validateDraft([{ productId, stock: -1, quantity: 2 }])).toThrow();
  });

  it("rejeita produtos duplicados", () => {
    expect(() => validateDraft([{ productId, stock: 0, quantity: 1 }, { productId, stock: 0, quantity: 2 }])).toThrow(/duplicado/);
  });

  it("gera revisão crescente e preserva versões", () => {
    expect(nextRevision([])).toBe(1);
    expect(nextRevision([1, 3, 2])).toBe(4);
  });

  it("relatório contém apenas quantidades positivas", () => {
    expect(conferenceItems([{ quantity: 0 }, { quantity: 2 }])).toEqual([{ quantity: 2 }]);
  });
});
