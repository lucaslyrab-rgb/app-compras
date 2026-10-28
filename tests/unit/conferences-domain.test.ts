import { describe, expect, it } from "vitest";
import {
  ConferenceValidationError,
  getItemStatus,
  parseWeightInput,
  validateReceivedWeight,
  calculateConferenceProgress,
  assertCanFinalizeConference,
} from "@/modules/purchasing/conferences/domain";

describe("Domínio de Conferência de Entrega (Fase 5)", () => {
  describe("getItemStatus", () => {
    it("identifica item não recebido como UNRECEIVED", () => {
      expect(getItemStatus({ receivedWeightKg: 0, isUnreceived: true })).toBe("UNRECEIVED");
      expect(getItemStatus({ receivedWeightKg: null, isUnreceived: true })).toBe("UNRECEIVED");
    });

    it("identifica item com peso positivo como RECEIVED", () => {
      expect(getItemStatus({ receivedWeightKg: 15.5, isUnreceived: false })).toBe("RECEIVED");
      expect(getItemStatus({ receivedWeightKg: 0.1, isUnreceived: false })).toBe("RECEIVED");
    });

    it("identifica item sem peso e sem flag como PENDING", () => {
      expect(getItemStatus({ receivedWeightKg: null, isUnreceived: false })).toBe("PENDING");
      expect(getItemStatus({ receivedWeightKg: 0, isUnreceived: false })).toBe("PENDING");
    });
  });

  describe("parseWeightInput", () => {
    it("converte strings válidas com vírgula ou ponto para número com 2 casas", () => {
      expect(parseWeightInput("162,40")).toBe(162.4);
      expect(parseWeightInput("15.5")).toBe(15.5);
      expect(parseWeightInput("0.056")).toBe(0.06);
      expect(parseWeightInput(42.5)).toBe(42.5);
    });

    it("retorna null para vazios ou nulos", () => {
      expect(parseWeightInput("")).toBeNull();
      expect(parseWeightInput("   ")).toBeNull();
      expect(parseWeightInput(null)).toBeNull();
      expect(parseWeightInput(undefined)).toBeNull();
    });

    it("rejeita strings alfanuméricas e NaN", () => {
      expect(() => parseWeightInput("abc")).toThrow(ConferenceValidationError);
      expect(() => parseWeightInput("NaN")).toThrow(ConferenceValidationError);
      expect(() => parseWeightInput("12.34.56")).toThrow(ConferenceValidationError);
    });
  });

  describe("validateReceivedWeight", () => {
    it("aceita null e pesos válidos positivos", () => {
      expect(() => validateReceivedWeight(null)).not.toThrow();
      expect(() => validateReceivedWeight(10.5)).not.toThrow();
      expect(() => validateReceivedWeight(0)).not.toThrow();
    });

    it("rejeita pesos negativos e valores inválidos", () => {
      expect(() => validateReceivedWeight(-5)).toThrow("O peso recebido não pode ser negativo");
      expect(() => validateReceivedWeight(Number.NaN)).toThrow("valor numérico inválido");
      expect(() => validateReceivedWeight(Number.POSITIVE_INFINITY)).toThrow("valor numérico inválido");
      expect(() => validateReceivedWeight(100000)).toThrow("excede o limite máximo permitido");
    });
  });

  describe("calculateConferenceProgress", () => {
    it("calcula progresso, pendentes e percentual corretamente", () => {
      const items = [
        { receivedWeightKg: 10.5, isUnreceived: false }, // RECEIVED
        { receivedWeightKg: 0, isUnreceived: true },    // UNRECEIVED
        { receivedWeightKg: null, isUnreceived: false }, // PENDING
        { receivedWeightKg: null, isUnreceived: false }, // PENDING
      ];

      const progress = calculateConferenceProgress(items);
      expect(progress.total).toBe(4);
      expect(progress.verified).toBe(2);
      expect(progress.pending).toBe(2);
      expect(progress.percent).toBe(50);
    });

    it("retorna 100% quando todos os itens estão conferidos", () => {
      const items = [
        { receivedWeightKg: 10.5, isUnreceived: false },
        { receivedWeightKg: 0, isUnreceived: true },
      ];

      const progress = calculateConferenceProgress(items);
      expect(progress.total).toBe(2);
      expect(progress.verified).toBe(2);
      expect(progress.pending).toBe(0);
      expect(progress.percent).toBe(100);
    });
  });

  describe("assertCanFinalizeConference", () => {
    it("permite finalizar quando todos os itens estão verificados (peso positivo ou não recebido)", () => {
      const items = [
        { productName: "Tomate", receivedWeightKg: 15.5, isUnreceived: false },
        { productName: "Alface", receivedWeightKg: 0, isUnreceived: true },
      ];

      expect(() => assertCanFinalizeConference(items)).not.toThrow();
    });

    it("bloqueia finalização quando existem itens pendentes", () => {
      const items = [
        { productName: "Tomate", receivedWeightKg: 15.5, isUnreceived: false },
        { productName: "Alface", receivedWeightKg: null, isUnreceived: false },
      ];

      expect(() => assertCanFinalizeConference(items)).toThrow(
        "Não é possível finalizar a conferência: ainda existem 1 item(ns) pendente(s)"
      );
    });
  });
});
