import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("next/link", () => ({ default: () => null }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/app/login/actions", () => ({ logoutAction: vi.fn() }));

const { visibleMenuGroups } = await import("@/modules/navigation/operational-shell");
import { ROLE_DEFAULT_PERMISSIONS } from "@/modules/identity/domain";

const labels = (items: { label: string }[]) => items.map((item) => item.label);

describe("menu lateral", () => {
  it("Gestor vê cada tela uma única vez", () => {
    const groups = visibleMenuGroups(ROLE_DEFAULT_PERMISSIONS.GESTOR);
    const all = [...labels(groups.buyer), ...labels(groups.manager), ...labels(groups.control)];
    expect(all.filter((label) => label === "Fornecedores")).toHaveLength(1);
    expect(all.filter((label) => label === "Perdas FLV")).toHaveLength(1);
    expect(labels(groups.manager)).toContain("Fornecedores");
    expect(labels(groups.buyer)).toContain("Perdas FLV");
    expect(labels(groups.control)).toEqual(["Fechamento integrado"]);
  });

  it("Comprador mantém Fornecedores e Perdas no grupo Comprador", () => {
    const groups = visibleMenuGroups(ROLE_DEFAULT_PERMISSIONS.COMPRADOR);
    expect(labels(groups.buyer)).toEqual(["Consolidado", "Lançamento de Custos", "Destinação", "Fornecedores", "Perdas FLV"]);
    expect(groups.manager).toEqual([]);
    expect(groups.control).toEqual([]);
  });

  it("usuário do CPD vê só o Fechamento integrado", () => {
    const groups = visibleMenuGroups(["fechamento:consultar"]);
    expect(groups.buyer).toEqual([]);
    expect(groups.manager).toEqual([]);
    expect(labels(groups.control)).toEqual(["Fechamento integrado"]);
  });
});
