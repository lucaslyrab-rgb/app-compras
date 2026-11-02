import { describe, expect, it } from "vitest";
import {
  conferenceCardStatus,
  conferencePercent,
  formatLossTotal,
  homeReminder,
  orderCardStatus,
  type StoreHomeOrder,
  type StoreHomeSummary,
} from "@/modules/store-home/domain";

const baseOrder: StoreHomeOrder = {
  submittedAt: null,
  submittedItems: 0,
  draftItems: 0,
  cutoffAt: "2026-11-02T23:00:00.000Z", // 20:00 em São Paulo
  cycleDate: "2026-11-03",
};
const beforeCutoff = new Date("2026-11-02T15:00:00.000Z");
const afterCutoff = new Date("2026-11-03T01:00:00.000Z");

describe("Início da loja — cartão do pedido", () => {
  it("convida a fazer o pedido quando não há rascunho", () => {
    expect(orderCardStatus(baseOrder, beforeCutoff)).toEqual({
      tone: "partial",
      label: "Não enviado",
      detail: "Compra 03/11 · envie até 20:00",
      action: "Fazer pedido",
    });
  });

  it("mostra o rascunho e o prazo", () => {
    const status = orderCardStatus({ ...baseOrder, draftItems: 12 }, beforeCutoff);
    expect(status.detail).toBe("Rascunho · 12 produtos · envie até 20:00");
    expect(status.action).toBe("Continuar pedido");
  });

  it("confirma o envio com horário", () => {
    const status = orderCardStatus(
      { ...baseOrder, submittedAt: "2026-11-02T21:07:00.000Z", submittedItems: 1 },
      beforeCutoff,
    );
    expect(status).toMatchObject({ tone: "integral", label: "Enviado", action: "Revisar pedido" });
    expect(status.detail).toBe("Compra 03/11 · 1 produto · enviado às 18:07");
  });

  it("avisa quando o prazo terminou sem envio", () => {
    expect(orderCardStatus(baseOrder, afterCutoff)).toMatchObject({ tone: "total", label: "Prazo encerrado" });
  });
});

describe("Início da loja — conferência e perdas", () => {
  it("calcula o progresso da conferência", () => {
    const conference = { cycleDate: "2026-10-31", status: "IN_PROGRESS" as const, totalItems: 34, verifiedItems: 21 };
    expect(conferencePercent(conference)).toBe(62);
    expect(conferencePercent(null)).toBe(0);
    expect(conferenceCardStatus(conference)).toMatchObject({
      tone: "partial",
      label: "13 para pesar",
      detail: "Compra 31/10 · 21 de 34 pesados",
    });
  });

  it("indica conferência finalizada ou inexistente", () => {
    expect(
      conferenceCardStatus({ cycleDate: "2026-10-31", status: "FINALIZED", totalItems: 34, verifiedItems: 34 }).label,
    ).toBe("Finalizada");
    expect(conferenceCardStatus(null).label).toBe("Sem chegada");
  });

  it("formata o total de perdas do dia", () => {
    expect(formatLossTotal({ count: 3, kg: 4.5, und: 0 })).toBe("4,5 kg");
    expect(formatLossTotal({ count: 2, kg: 0, und: 3 })).toBe("3 und");
    expect(formatLossTotal({ count: 0, kg: 0, und: 0 })).toBe("0 kg");
  });

  it("lembra primeiro da pesagem pendente, depois do pedido", () => {
    const summary: StoreHomeSummary = {
      order: baseOrder,
      conference: { cycleDate: "2026-10-31", status: "IN_PROGRESS", totalItems: 34, verifiedItems: 21 },
      losses: { count: 0, kg: 0, und: 0 },
    };
    expect(homeReminder(summary, beforeCutoff)).toBe("A chegada de 31/10 ainda tem 13 itens para pesar.");
    expect(homeReminder({ ...summary, conference: null }, beforeCutoff)).toBe(
      "O pedido da compra 03/11 ainda não foi enviado.",
    );
    expect(homeReminder({ ...summary, conference: null }, afterCutoff)).toBeNull();
  });
});
