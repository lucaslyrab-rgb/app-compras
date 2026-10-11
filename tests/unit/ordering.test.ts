import { describe, expect, it } from "vitest";
import {
  conferenceItems,
  formatDateTime,
  formatTime,
  nextRevision,
  validateDraft,
} from "@/modules/ordering/domain";

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

  describe("formatação de horários operacionais no fuso America/Sao_Paulo", () => {
    it("exibe o instante real de envio de Balneário (2026-10-07T19:42:14Z) como 16:42", () => {
      const utcString = "2026-10-07T19:42:14.671Z";
      const dateObj = new Date(utcString);

      expect(formatTime(utcString)).toBe("16:42");
      expect(formatTime(dateObj)).toBe("16:42");

      expect(formatDateTime(utcString)).toMatch(/^07\/10\/2026[,\s]+16:42$/);
      expect(formatDateTime(dateObj)).toMatch(/^07\/10\/2026[,\s]+16:42$/);
    });

    it("formata corretamente horários próximos ao corte das 20h", () => {
      // 19:58 local (2 minutos antes do corte de 20:00) = 22:58 UTC
      const nearCutoffUtc = "2026-10-07T22:58:00.000Z";
      expect(formatTime(nearCutoffUtc)).toBe("19:58");
      expect(formatDateTime(nearCutoffUtc)).toMatch(/^07\/10\/2026[,\s]+19:58$/);

      // 20:00 local (exatamente no corte) = 23:00 UTC
      const cutoffUtc = "2026-10-07T23:00:00.000Z";
      expect(formatTime(cutoffUtc)).toBe("20:00");
      expect(formatDateTime(cutoffUtc)).toMatch(/^07\/10\/2026[,\s]+20:00$/);
    });

    it("trata virada de dia em UTC preservando a data correta do dia anterior em São Paulo", () => {
      // 01:30 UTC do dia 08/10 corresponde a 22:30 do dia 07/10 em São Paulo (-3h)
      const lateNightUtc = "2026-10-08T01:30:00.000Z";
      expect(formatTime(lateNightUtc)).toBe("22:30");
      expect(formatDateTime(lateNightUtc)).toMatch(/^07\/10\/2026[,\s]+22:30$/);

      // 02:59 UTC do dia 08/10 corresponde a 23:59 do dia 07/10 em São Paulo
      const midnightEveUtc = "2026-10-08T02:59:59.000Z";
      expect(formatTime(midnightEveUtc)).toBe("23:59");
      expect(formatDateTime(midnightEveUtc)).toMatch(/^07\/10\/2026[,\s]+23:59$/);

      // 03:00 UTC do dia 08/10 corresponde exatamente à meia-noite (00:00) do dia 08/10 em São Paulo
      const midnightUtc = "2026-10-08T03:00:00.000Z";
      expect(formatTime(midnightUtc)).toBe("00:00");
      expect(formatDateTime(midnightUtc)).toMatch(/^08\/10\/2026[,\s]+00:00$/);
    });

    it("garante consistência de formatação entre Histórico, Detalhes e Consolidado", () => {
      const submissionUtc = "2026-10-07T19:42:14.671Z";

      // Formatação no Histórico da Loja (formatTime)
      const historyTime = formatTime(submissionUtc);
      expect(historyTime).toBe("16:42");

      // Formatação nos Detalhes do Pedido (formatDateTime)
      const detailsDateTime = formatDateTime(submissionUtc);
      expect(detailsDateTime).toMatch(/^07\/10\/2026[,\s]+16:42$/);

      // Formatação no Consolidado do Comprador (Intl.DateTimeFormat com timeZone: America/Sao_Paulo)
      const consolidatedDesktop = new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(submissionUtc));
      expect(consolidatedDesktop).toMatch(/^07\/10\/2026[,\s]+16:42$/);

      // Formatação no Consolidado mobile (compactTimestamp)
      const compactFmt = new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const parts = compactFmt.formatToParts(new Date(submissionUtc));
      const part = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((item) => item.type === type)?.value ?? "";
      const consolidatedMobile = `${part("day")}/${part("month")} ${part("hour")}:${part("minute")}`;
      expect(consolidatedMobile).toBe("07/10 16:42");

      // Todos convergem exatamente para 16:42
      expect(detailsDateTime).toContain(historyTime);
      expect(consolidatedDesktop).toContain(historyTime);
      expect(consolidatedMobile).toContain(historyTime);
    });
  });
});
