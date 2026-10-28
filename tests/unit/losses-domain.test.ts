import { describe, expect, it } from "vitest";
import {
  LossValidationError,
  parseLossQuantity,
  aggregateLossTotals,
  calculateLossDashboardKpis,
  STANDARD_LOSS_REASONS,
  type StoreLossRecord,
} from "@/modules/purchasing/losses/domain";

describe("Domínio de Registro e Consulta de Perdas (Fase 5)", () => {
  describe("parseLossQuantity", () => {
    it("converte valores numéricos e strings formatadas para decimal com 2 casas", () => {
      expect(parseLossQuantity("4,50")).toBe(4.5);
      expect(parseLossQuantity("12.30")).toBe(12.3);
      expect(parseLossQuantity(6)).toBe(6);
      expect(parseLossQuantity("0.25")).toBe(0.25);
    });

    it("rejeita zero, valores negativos e nulos", () => {
      expect(() => parseLossQuantity("0")).toThrow(LossValidationError);
      expect(() => parseLossQuantity(0)).toThrow(LossValidationError);
      expect(() => parseLossQuantity("-2.5")).toThrow(LossValidationError);
      expect(() => parseLossQuantity("")).toThrow(LossValidationError);
      expect(() => parseLossQuantity(null)).toThrow(LossValidationError);
      expect(() => parseLossQuantity(undefined)).toThrow(LossValidationError);
    });

    it("rejeita NaN e valores excessivos", () => {
      expect(() => parseLossQuantity("abc")).toThrow(LossValidationError);
      expect(() => parseLossQuantity("NaN")).toThrow(LossValidationError);
      expect(() => parseLossQuantity(100000)).toThrow(LossValidationError);
    });
  });

  describe("formatUnitTotals e aggregateLossTotals", () => {
    it("mantém totais de KG e UND rigorosamente separados (sem somar unidades incompatíveis)", () => {
      const items = [
        { quantity: 4.5, unit: "KG" },
        { quantity: 6.0, unit: "UND" },
        { quantity: 12.3, unit: "KG" },
      ];

      const result = aggregateLossTotals(items);
      expect(result.kg).toBe(16.8);
      expect(result.und).toBe(6.0);
      expect(result.formatted).toBe("16.80 KG e 6 UND");
    });

    it("formata corretamente quando houver somente KG", () => {
      const result = aggregateLossTotals([
        { quantity: 5.25, unit: "KG" },
        { quantity: 4.75, unit: "KG" },
      ]);
      expect(result.kg).toBe(10.0);
      expect(result.und).toBe(0);
      expect(result.formatted).toBe("10.00 KG");
    });

    it("formata corretamente quando houver somente UND", () => {
      const result = aggregateLossTotals([
        { quantity: 3, unit: "UND" },
        { quantity: 5, unit: "UNIDADE" },
      ]);
      expect(result.kg).toBe(0);
      expect(result.und).toBe(8);
      expect(result.formatted).toBe("8 UND");
    });
  });

  describe("calculateLossDashboardKpis", () => {
    it("determina a loja líder de descarte e o produto com maior quebra", () => {
      const records: StoreLossRecord[] = [
        {
          id: "1",
          storeId: "s1",
          storeName: "Ponta da Fruta",
          productId: "p1",
          erpCode: 305,
          productName: "Tomate Débora",
          photoKey: null,
          photoUpdatedAt: null,
          quantity: 4.5,
          unit: "KG",
          reason: "Maduro / Passado",
          notes: null,
          recordedAt: "2026-10-28T15:40:00Z",
          recordedBy: "u1",
        },
        {
          id: "2",
          storeId: "s2",
          storeName: "Balneário",
          productId: "p2",
          erpCode: 204,
          productName: "Melancia Graúda",
          photoKey: null,
          photoUpdatedAt: null,
          quantity: 18.2,
          unit: "KG",
          reason: "Avaria no Transporte",
          notes: null,
          recordedAt: "2026-10-28T14:15:00Z",
          recordedBy: "u2",
        },
        {
          id: "3",
          storeId: "s1",
          storeName: "Ponta da Fruta",
          productId: "p1",
          erpCode: 305,
          productName: "Tomate Débora",
          photoKey: null,
          photoUpdatedAt: null,
          quantity: 2.3,
          unit: "KG",
          reason: "Quebra Interna / Manuseio",
          notes: null,
          recordedAt: "2026-10-28T16:00:00Z",
          recordedBy: "u1",
        },
      ];

      const kpis = calculateLossDashboardKpis(records);
      expect(kpis.totalRecords).toBe(3);
      expect(kpis.totals.kg).toBe(25.0);
      expect(kpis.topStoreByUnit.KG?.storeName).toBe("Balneário");
      expect(kpis.topStoreByUnit.KG?.total).toBe(18.2);
      expect(kpis.topProductByUnit.KG?.productName).toBe("Melancia Graúda");
      expect(kpis.topProductByUnit.KG?.total).toBe(18.2);
      expect(kpis.topStoreByUnit.UND).toBeNull();
      expect(kpis.topProductByUnit.UND).toBeNull();
    });

    it("não mistura KG e UND no ranking de loja/produto líder", () => {
      const records: StoreLossRecord[] = [
        {
          id: "1",
          storeId: "s1",
          storeName: "Ponta da Fruta",
          productId: "p1",
          erpCode: 100,
          productName: "Ovo Branco",
          photoKey: null,
          photoUpdatedAt: null,
          quantity: 10,
          unit: "UND",
          reason: "Quebra Interna / Manuseio",
          notes: null,
          recordedAt: "2026-10-28T10:00:00Z",
          recordedBy: "u1",
        },
        {
          id: "2",
          storeId: "s2",
          storeName: "Balneário",
          productId: "p2",
          erpCode: 200,
          productName: "Abacaxi",
          photoKey: null,
          photoUpdatedAt: null,
          quantity: 8,
          unit: "KG",
          reason: "Maduro / Passado",
          notes: null,
          recordedAt: "2026-10-28T11:00:00Z",
          recordedBy: "u2",
        },
      ];

      const kpis = calculateLossDashboardKpis(records);
      // 10 UND não pode superar 8 KG só porque o número bruto é maior.
      expect(kpis.topStoreByUnit.UND?.storeName).toBe("Ponta da Fruta");
      expect(kpis.topStoreByUnit.UND?.total).toBe(10);
      expect(kpis.topStoreByUnit.KG?.storeName).toBe("Balneário");
      expect(kpis.topStoreByUnit.KG?.total).toBe(8);
      expect(kpis.topProductByUnit.UND?.productName).toBe("Ovo Branco");
      expect(kpis.topProductByUnit.KG?.productName).toBe("Abacaxi");
    });
  });

  describe("STANDARD_LOSS_REASONS", () => {
    it("contém os 5 motivos padronizados de descarte", () => {
      expect(STANDARD_LOSS_REASONS).toEqual([
        "Avaria no Transporte",
        "Maduro / Passado",
        "Quebra Interna / Manuseio",
        "Qualidade / Broto / Murcha",
        "Outro",
      ]);
    });
  });
});
