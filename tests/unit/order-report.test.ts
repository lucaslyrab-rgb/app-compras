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
  ORDER_PRINT_TWO_COLUMN_THRESHOLD,
  sortReportItems,
  splitReportItems,
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

  it("divide lista de produtos em 2 colunas de forma determinística preservando ordenação", () => {
    expect(ORDER_PRINT_TWO_COLUMN_THRESHOLD).toBe(15);

    // 19 itens (caso real): 10 à esquerda (ceil), 9 à direita (floor)
    const items19 = Array.from({ length: 19 }, (_, i) => ({
      erpCode: 1000 + i,
      name: `Produto ${String.fromCharCode(65 + i)}`,
      unit: "UN",
      quantity: 5,
    }));
    const [left19, right19] = splitReportItems(items19);
    expect(left19).toHaveLength(10);
    expect(right19).toHaveLength(9);
    expect(left19[0].name).toBe("Produto A");
    expect(left19[9].name).toBe("Produto J");
    expect(right19[0].name).toBe("Produto K");
    expect(right19[8].name).toBe("Produto S");

    // Número par (16 itens): 8 e 8
    const items16 = Array.from({ length: 16 }, (_, i) => ({ id: i }));
    const [left16, right16] = splitReportItems(items16);
    expect(left16).toHaveLength(8);
    expect(right16).toHaveLength(8);

    // Array vazio
    const [leftEmpty, rightEmpty] = splitReportItems([]);
    expect(leftEmpty).toEqual([]);
    expect(rightEmpty).toEqual([]);
  });

  it("organiza cabeçalho horizontal compacto com identidade à esquerda e metadados à direita", () => {
    const html = renderToString(
      React.createElement(OrderReportView, {
        order: baseOrder,
        storeName: "MultiShow Ponta da Fruta",
        items: sampleItems,
      }),
    );

    // Estrutura de cabeçalho horizontal
    expect(html).toContain("order-report__header-row");
    expect(html).toContain("order-report__identity");
    expect(html).toContain("order-report__meta-box");

    // Identidade: logo + título + badge
    expect(html).toContain("MultiShow FLV");
    expect(html).toContain("PEDIDO FLV");
    expect(html).toContain("Revisão 2");

    // Metadados em bloco compacto
    expect(html).toContain("Loja");
    expect(html).toContain("Ciclo de compra");
    expect(html).toContain("Data e horário de envio");
    expect(html).toContain("Número da revisão");
  });

  it("renderiza pedido com 19 itens reais em duas colunas lado a lado no A4/desktop", () => {
    const real19Items: OrderReportItem[] = [
      { erpCode: 101, name: "ABACAXI PÉROLA", unit: "UN", quantity: "15" },
      { erpCode: 102, name: "BANANA PRATA", unit: "CX", quantity: "8" },
      { erpCode: 103, name: "BATATA INGLESA", unit: "SC", quantity: "12" },
      { erpCode: 104, name: "CEBOLA NACIONAL", unit: "SC", quantity: "10" },
      { erpCode: 105, name: "CENOURA", unit: "CX", quantity: "6" },
      { erpCode: 106, name: "CHUCHU", unit: "CX", quantity: "4" },
      { erpCode: 107, name: "LARANJA PERA", unit: "SC", quantity: "14" },
      { erpCode: 108, name: "LIMÃO TAITI", unit: "CX", quantity: "5" },
      { erpCode: 109, name: "MAÇÃ FUJI", unit: "CX", quantity: "7" },
      { erpCode: 110, name: "MAMÃO FORMOSA", unit: "CX", quantity: "9" },
      { erpCode: 111, name: "MANGA TOMMY", unit: "CX", quantity: "11" },
      { erpCode: 112, name: "MELANCIA", unit: "KG", quantity: "150" },
      { erpCode: 113, name: "MELÃO AMARELO", unit: "CX", quantity: "8" },
      { erpCode: 114, name: "MORANGO", unit: "CX", quantity: "20" },
      { erpCode: 115, name: "OVOS BRANCOS", unit: "CX", quantity: "3" },
      { erpCode: 116, name: "PEPINO COMUM", unit: "CX", quantity: "4" },
      { erpCode: 117, name: "PIMENTÃO VERDE", unit: "CX", quantity: "5" },
      { erpCode: 118, name: "REPOLHO VERDE", unit: "SC", quantity: "6" },
      { erpCode: 119, name: "TOMATE ITALIANO", unit: "CX", quantity: "18" },
    ];

    const html = renderToString(
      React.createElement(OrderReportView, {
        order: baseOrder,
        storeName: "MultiShow Ponta da Fruta",
        items: real19Items,
      }),
    );

    // Deve ativar classe de duas colunas
    expect(html).toContain("order-report--two-columns");
    expect(html).toContain("order-report__columns");
    expect(html).toContain("order-report__col");

    // Duas subtabelas com seus respectivos cabeçalhos
    expect(html).toContain("Coluna 1");
    expect(html).toContain("Coluna 2");

    // Primeira metade (10 itens) na Coluna 1: de ABACAXI até MAMÃO FORMOSA
    const abacaxiIndex = html.indexOf("ABACAXI PÉROLA");
    const mamaoIndex = html.indexOf("MAMÃO FORMOSA");
    const mangaIndex = html.indexOf("MANGA TOMMY");
    const tomateIndex = html.indexOf("TOMATE ITALIANO");

    expect(abacaxiIndex).toBeGreaterThan(-1);
    expect(mamaoIndex).toBeGreaterThan(abacaxiIndex);
    expect(mangaIndex).toBeGreaterThan(mamaoIndex);
    expect(tomateIndex).toBeGreaterThan(mangaIndex);

    // Total de itens pedidos no resumo único
    expect(html).toContain("Total de itens pedidos:");
    expect(html).toContain("19 itens");
  });

  it("renderiza pedidos pequenos (<= 15 itens) em coluna única sem duplicar tabelas", () => {
    const smallItems: OrderReportItem[] = [
      { erpCode: 101, name: "ABACAXI", unit: "UN", quantity: "5" },
      { erpCode: 102, name: "BANANA", unit: "CX", quantity: "3" },
      { erpCode: 103, name: "CEBOLA", unit: "SC", quantity: "4" },
    ];

    const html = renderToString(
      React.createElement(OrderReportView, {
        order: baseOrder,
        storeName: "Loja Teste",
        items: smallItems,
      }),
    );

    expect(html).toContain("order-report--single-column");
    expect(html).toContain("order-report__table-wrap");
    expect(html).not.toContain("order-report__columns");
    expect(html).not.toContain("Coluna 1");
    expect(html).not.toContain("Coluna 2");
    expect(html).toContain("3 itens");
  });

  it("mantém relatório de conferência em coluna única para preservar área de anotação", () => {
    const items18: OrderReportItem[] = Array.from({ length: 18 }, (_, i) => ({
      erpCode: 200 + i,
      name: `Item Conferência ${i + 1}`,
      unit: "CX",
      quantity: "10",
    }));

    const html = renderToString(
      React.createElement(OrderReportView, {
        order: baseOrder,
        storeName: "Loja Teste",
        items: items18,
        variant: "conferencia",
      }),
    );

    // Mesmo com 18 itens (> 15), conferência permanece em coluna única
    expect(html).toContain("order-report--single-column");
    expect(html).toContain("order-report--conferencia");
    expect(html).not.toContain("order-report__columns");
    expect(html).toContain("Recebido");
    expect(html).toContain("order-report__check-line");
  });

  it("possui regras CSS de impressão para 2 colunas e tipografia compacta de 8pt", async () => {
    const css = await readFile("src/app/styles.css", "utf8");

    // Grid de 2 colunas no desktop e print
    expect(css).toMatch(/\.order-report__columns\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*1fr 1fr/);
    expect(css).toMatch(/@media print[\s\S]*?\.order-report__columns[\s\S]*?grid-template-columns:\s*1fr 1fr !important/);

    // Tipografia compacta e paddings reduzidos no print
    expect(css).toMatch(/@media print[\s\S]*?\.order-report__table[\s\S]*?font-size:\s*8pt !important/);
    expect(css).toMatch(/@media print[\s\S]*?\.order-report__table th,\s*\.order-report__table td[\s\S]*?padding:\s*2\.5px 4px !important/);
    expect(css).toMatch(/@media print[\s\S]*?\.order-report__header-row[\s\S]*?display:\s*flex !important/);

    // Mobile empilha colunas suavemente em 1fr
    expect(css).toMatch(/@media \(max-width:\s*480px\)[\s\S]*?\.order-report__columns\s*\{\s*grid-template-columns:\s*1fr/);
  });
});
