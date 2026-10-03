import { describe, expect, it } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { assertStoreAccess, type Principal, AuthorizationError } from "@/modules/identity";
import {
  filterReportItems,
  formatCycleDate,
  formatDateTime,
  formatOrderQuantity,
  sortReportItems,
  type OrderReportHeader,
  type OrderReportItem,
} from "@/modules/ordering/domain";
import { OrderReportView } from "@/modules/ordering/order-report-view";
import { OrderPrintButton } from "@/app/pedidos/[id]/impressao/print-button";

describe("relatório de impressão do pedido da loja", () => {
  const baseOrder: OrderReportHeader = {
    id: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    orderDate: "2026-10-03",
    purchaseCycleDate: "2026-10-06",
    revision: 2,
    submittedAt: new Date("2026-10-03T15:30:00-03:00"),
    cancelledAt: null,
    cancellationReason: null,
  };

  const sampleItems: OrderReportItem[] = [
    { erpCode: 1002, name: "Cebola Nacional", unit: "SC", quantity: "5.00" },
    { erpCode: 1001, name: "Abacaxi Pérola", unit: "UN", quantity: "10.00" },
    { erpCode: 1003, name: "Tomate Italiano", unit: "CX", quantity: "0.00" },
    { erpCode: 1004, name: "Banana Prata", unit: "CX", quantity: "8.50" },
  ];

  it("garante que a revisão selecionada é exatamente a revisão impressa", () => {
    const html = renderToString(
      React.createElement(OrderReportView, {
        order: baseOrder,
        storeName: "MultiShow Ponta da Fruta",
        items: sampleItems,
      }),
    );

    // Revisão 2 explícita no título e metadados
    expect(html).toContain("Revisão 2");
    expect(html).toContain("MultiShow Ponta da Fruta");
    expect(html).toContain("06/10/2026");
    expect(html).not.toContain("Revisão 1");
    expect(html).not.toContain("Revisão 3");

    expect(formatCycleDate("2026-10-06")).toBe("06/10/2026");
    expect(formatDateTime(new Date("2026-10-03T15:30:00-03:00"))).toContain("03/10/2026");
  });

  it("impede acesso cruzado entre lojas na autorização de histórico", () => {
    const storePrincipal: Principal = {
      userId: "user-1",
      role: "LOJA",
      storeId: "store-ponta-da-fruta",
      permissions: ["pedidos:historico", "pedidos:criar"],
    };

    // Acesso permitido à própria loja
    expect(() => assertStoreAccess(storePrincipal, "store-ponta-da-fruta")).not.toThrow();

    // Acesso negado a outra loja
    expect(() => assertStoreAccess(storePrincipal, "store-balneario")).toThrow(
      AuthorizationError,
    );
    expect(() => assertStoreAccess(storePrincipal, "store-balneario")).toThrow(
      /Acesso negado/,
    );

    // Usuário sem storeId
    const unassignedPrincipal: Principal = {
      userId: "user-2",
      role: "GESTOR",
      storeId: null,
      permissions: ["pedidos:historico"],
    };
    expect(() => assertStoreAccess(unassignedPrincipal, "store-ponta-da-fruta")).toThrow(
      AuthorizationError,
    );
  });

  it("utiliza snapshots históricos de código, nome e unidade sem depender do cadastro atual", () => {
    const historicalItems: OrderReportItem[] = [
      {
        erpCode: 9999,
        name: "NOME HISTÓRICO ORIGINAL",
        unit: "CX HISTÓRICA",
        quantity: "15.00",
      },
    ];

    const html = renderToString(
      React.createElement(OrderReportView, {
        order: baseOrder,
        storeName: "Loja Teste",
        items: historicalItems,
      }),
    );

    expect(html).toContain("9999");
    expect(html).toContain("NOME HISTÓRICO ORIGINAL");
    expect(html).toContain("CX HISTÓRICA");
    expect(html).toContain("15");
  });

  it("filtra itens e exibe no relatório somente produtos com quantidade pedida maior que zero", () => {
    const filtered = filterReportItems(sampleItems);
    expect(filtered).toHaveLength(3);
    expect(filtered.map((item) => item.erpCode)).toEqual([1002, 1001, 1004]);
    expect(filtered.find((item) => item.erpCode === 1003)).toBeUndefined();

    // Na renderização
    const html = renderToString(
      React.createElement(OrderReportView, {
        order: baseOrder,
        storeName: "Loja Teste",
        items: sampleItems,
      }),
    );

    expect(html).toContain("Abacaxi Pérola");
    expect(html).toContain("Cebola Nacional");
    expect(html).toContain("Banana Prata");
    expect(html).not.toContain("Tomate Italiano");

    // Formatação de quantidades sem quebras ou decimais supérfluos
    expect(formatOrderQuantity("10.00")).toBe("10");
    expect(formatOrderQuantity("8.50")).toBe("8,5");
    expect(formatOrderQuantity(5)).toBe("5");

    // Estado vazio quando não houver itens com quantidade > 0
    const emptyHtml = renderToString(
      React.createElement(OrderReportView, {
        order: baseOrder,
        storeName: "Loja Teste",
        items: [{ erpCode: 1003, name: "Tomate", unit: "CX", quantity: 0 }],
      }),
    );
    expect(emptyHtml).toContain("Nenhum produto com quantidade pedida nesta revisão");
  });

  it("ordena produtos alfabeticamente conforme a visualização da loja", () => {
    const sorted = sortReportItems([
      { name: "Tomate", quantity: 1 },
      { name: "Abacaxi", quantity: 1 },
      { name: "Cenoura", quantity: 1 },
      { name: "Banana", quantity: 1 },
    ]);

    expect(sorted.map((i) => i.name)).toEqual(["Abacaxi", "Banana", "Cenoura", "Tomate"]);

    const html = renderToString(
      React.createElement(OrderReportView, {
        order: baseOrder,
        storeName: "Loja Teste",
        items: sampleItems,
      }),
    );

    // Ordem no HTML: Abacaxi Pérola -> Banana Prata -> Cebola Nacional
    const abacaxiIndex = html.indexOf("Abacaxi Pérola");
    const bananaIndex = html.indexOf("Banana Prata");
    const cebolaIndex = html.indexOf("Cebola Nacional");

    expect(abacaxiIndex).toBeGreaterThan(-1);
    expect(bananaIndex).toBeGreaterThan(abacaxiIndex);
    expect(cebolaIndex).toBeGreaterThan(bananaIndex);
  });

  it("apresenta claramente alerta, data e motivo quando o pedido está cancelado", () => {
    const cancelledOrder: OrderReportHeader = {
      ...baseOrder,
      cancelledAt: new Date("2026-10-03T16:45:00-03:00"),
      cancellationReason: "Cancelamento solicitado pelo gerente da loja",
    };

    const html = renderToString(
      React.createElement(OrderReportView, {
        order: cancelledOrder,
        storeName: "Loja Teste",
        items: sampleItems,
      }),
    );

    expect(html).toContain("PEDIDO CANCELADO");
    expect(html).toContain("Cancelado em");
    expect(html).toContain("Cancelamento solicitado pelo gerente da loja");

    // Quando não cancelado, banner não deve existir
    const activeHtml = renderToString(
      React.createElement(OrderReportView, {
        order: baseOrder,
        storeName: "Loja Teste",
        items: sampleItems,
      }),
    );
    expect(activeHtml).not.toContain("PEDIDO CANCELADO");
  });

  it("renderiza o botão nativo de impressão e link na tela de detalhes", async () => {
    const buttonHtml = renderToString(React.createElement(OrderPrintButton));
    expect(buttonHtml).toContain("<button");
    expect(buttonHtml).toContain("Imprimir / Salvar PDF");

    // Verificar se o botão de impressão foi incluído na tela de detalhes
    const detalhesCode = await readFile("src/app/pedidos/[id]/detalhes/page.tsx", "utf8");
    expect(detalhesCode).toContain("/pedidos/${id}/impressao");
    expect(detalhesCode).toContain("Imprimir pedido");
  });

  it("prepara estrutura reutilizável para o futuro Relatório de Conferência", () => {
    const conferenceHtml = renderToString(
      React.createElement(OrderReportView, {
        order: baseOrder,
        storeName: "Loja Teste",
        items: sampleItems,
        variant: "conferencia",
      }),
    );

    expect(conferenceHtml).toContain("CONFERÊNCIA DE RECEBIMENTO — FLV");
    expect(conferenceHtml).toContain("Data do recebimento:");
    expect(conferenceHtml).toContain("Responsável pelo recebimento:");
    expect(conferenceHtml).toContain("Recebido");
    expect(conferenceHtml).toContain("order-report__check-line");
  });

  it("contém regras de CSS de impressão A4 com cabeçalho repetido e sem quebra em linhas", async () => {
    const css = await readFile("src/app/styles.css", "utf8");

    expect(css).toContain(".order-report");
    expect(css).toMatch(/@media print[\s\S]*?size:\s*A4 portrait/);
    expect(css).toMatch(/@media print[\s\S]*?\.order-report__actions[\s\S]*?display:\s*none\s*!important/);
    expect(css).toMatch(/@media print[\s\S]*?\.order-report__table thead[\s\S]*?display:\s*table-header-group/);
    expect(css).toMatch(/@media print[\s\S]*?\.order-report__table tr[\s\S]*?break-inside:\s*avoid/);
  });
});
