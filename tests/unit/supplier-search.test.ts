import { describe, expect, it } from "vitest";
import { supplierMatchesSearch } from "@/modules/suppliers/domain";

describe("busca de fornecedores", () => {
  const wg = { corporateName: "WG EMBALADOS LTDA", tradeName: "WG EMBALADOS", taxId: "61579388000111", contactName: null };
  const jeb = { corporateName: "JEB DISTRIBUIDORA LTDA", tradeName: "JEB", taxId: "48336863000160", contactName: "João Ângelo" };
  const semDoc = { corporateName: "Sítio Boa Esperança", tradeName: null, taxId: null, contactName: null };

  it("busca por nome não traz todo fornecedor com CNPJ", () => {
    expect([wg, jeb, semDoc].filter((s) => supplierMatchesSearch(s, "wg"))).toEqual([wg]);
    expect([wg, jeb, semDoc].filter((s) => supplierMatchesSearch(s, "jeb"))).toEqual([jeb]);
  });

  it("ignora acento e maiúscula; procura também no contato", () => {
    expect(supplierMatchesSearch(semDoc, "sitio boa")).toBe(true);
    expect(supplierMatchesSearch(jeb, "angelo")).toBe(true);
  });

  it("CNPJ com ou sem pontuação", () => {
    expect(supplierMatchesSearch(wg, "61.579.388")).toBe(true);
    expect(supplierMatchesSearch(jeb, "61.579.388")).toBe(false);
  });

  it("busca vazia mostra todos", () => {
    expect(supplierMatchesSearch(semDoc, "  ")).toBe(true);
  });
});
