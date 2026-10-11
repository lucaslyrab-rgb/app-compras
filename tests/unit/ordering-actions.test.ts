import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/modules/identity/audit", () => ({ recordAudit: vi.fn() }));

import { cancelOrderAction, saveDraftAction, submitOrderAction } from "@/modules/ordering/actions";
import * as sessionModule from "@/modules/identity/session";
import * as repositoryModule from "@/modules/ordering/repository";
import { ExistingOrderError } from "@/modules/ordering/repository";
import { formatDateTime, OrderValidationError } from "@/modules/ordering/domain";
import type { Principal } from "@/modules/identity";

describe("Ordering Server Actions - Validação defensiva", () => {
  const storePrincipal: Principal = {
    userId: "user-store-1",
    role: "LOJA",
    storeId: "store-uuid-1",
    permissions: ["pedidos:criar", "pedidos:historico"],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(sessionModule, "requirePrincipal").mockResolvedValue(storePrincipal);
  });

  describe("saveDraftAction", () => {
    it("rejeita entrada com texto não numérico no pedido sem gerar crash por NaN", async () => {
      const formData = new FormData();
      formData.set("storeId", "store-uuid-1");
      formData.set("orderDate", "2026-10-06");
      formData.set("version", "0");
      formData.append("productId", "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11");
      formData.append("stock", "1");
      formData.append("quantity", "abc");

      const res = await saveDraftAction({}, formData);
      expect(res.status).toBe("error");
      expect(res.message).toBe("Valor de quantidade de pedido inválido.");
    });

    it("rejeita entrada com texto não numérico no estoque", async () => {
      const formData = new FormData();
      formData.set("storeId", "store-uuid-1");
      formData.set("orderDate", "2026-10-06");
      formData.set("version", "0");
      formData.append("productId", "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11");
      formData.append("stock", "xyz");
      formData.append("quantity", "2");

      const res = await saveDraftAction({}, formData);
      expect(res.status).toBe("error");
      expect(res.message).toBe("Valor de estoque inválido.");
    });

    it("retorna erro amigável quando o repositório rejeita quantidade fracionada em formato discreto", async () => {
      vi.spyOn(repositoryModule, "saveDraft").mockRejectedValue(
        new OrderValidationError("Informe uma quantidade inteira. Para BANANA PRATA não é permitido quantidade fracionada em caixa.")
      );

      const formData = new FormData();
      formData.set("storeId", "store-uuid-1");
      formData.set("orderDate", "2026-10-06");
      formData.set("version", "0");
      formData.append("productId", "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11");
      formData.append("stock", "0,5");
      formData.append("quantity", "0,5");

      const res = await saveDraftAction({}, formData);
      expect(res.status).toBe("error");
      expect(res.message).toBe("Informe uma quantidade inteira. Para BANANA PRATA não é permitido quantidade fracionada em caixa.");
    });

    it("salva com sucesso quando estoque é fracionado e pedido é inteiro", async () => {
      const saveSpy = vi.spyOn(repositoryModule, "saveDraft").mockResolvedValue({ id: "draft-1", version: 1 });

      const formData = new FormData();
      formData.set("storeId", "store-uuid-1");
      formData.set("orderDate", "2026-10-06");
      formData.set("version", "0");
      formData.append("productId", "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11");
      formData.append("stock", "0,5");
      formData.append("quantity", "2");

      const res = await saveDraftAction({}, formData);
      expect(res.status).toBe("success");
      expect(res.version).toBe(1);
      expect(saveSpy).toHaveBeenCalledWith(
        storePrincipal,
        "store-uuid-1",
        "2026-10-06",
        0,
        [{ productId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", stock: 0.5, quantity: 2 }]
      );
    });
  });

  describe("submitOrderAction", () => {
    it("retorna erro de domínio quando saveDraft rejeita quantidade fracionada", async () => {
      vi.spyOn(repositoryModule, "saveDraft").mockRejectedValue(
        new OrderValidationError("Informe uma quantidade inteira. Para MAÇÃ FUJI não é permitido quantidade fracionada em caixa.")
      );

      const formData = new FormData();
      formData.set("storeId", "store-uuid-1");
      formData.set("orderDate", "2026-10-06");
      formData.set("version", "0");
      formData.append("productId", "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11");
      formData.append("stock", "1");
      formData.append("quantity", "1,5");

      const res = await submitOrderAction({}, formData);
      expect(res.status).toBe("error");
      expect(res.message).toBe("Informe uma quantidade inteira. Para MAÇÃ FUJI não é permitido quantidade fracionada em caixa.");
    });

    it("retorna status confirm com dados para o modal de revisão quando já existe pedido enviado", async () => {
      vi.spyOn(repositoryModule, "saveDraft").mockResolvedValue({ id: "draft-1", version: 1 });
      vi.spyOn(repositoryModule, "submitDraft").mockRejectedValue(
        new ExistingOrderError(new Date("2026-10-07T19:42:14.671Z"), "2026-10-08")
      );

      const formData = new FormData();
      formData.set("storeId", "store-uuid-1");
      formData.set("orderDate", "2026-10-06");
      formData.set("version", "0");
      formData.append("productId", "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11");
      formData.append("stock", "1");
      formData.append("quantity", "2");

      const res = await submitOrderAction({}, formData);
      expect(res.status).toBe("confirm");
      expect(res.existingSubmittedAt).toBe("2026-10-07T19:42:14.671Z");
      expect(res.purchaseCycleDate).toBe("2026-10-08");
      expect(res.version).toBe(1);
      // Validando que o dado retornado formata perfeitamente em America/Sao_Paulo (16:42)
      expect(formatDateTime(res.existingSubmittedAt!)).toMatch(/^07\/10\/2026[,\s]+16:42$/);
    });

    it("permite alterar o pedido existente quando allowRevision é 1", async () => {
      vi.spyOn(repositoryModule, "saveDraft").mockResolvedValue({ id: "draft-1", version: 2 });
      const submitDraftSpy = vi.spyOn(repositoryModule, "submitDraft").mockResolvedValue({
        id: "order-1",
        revision: 2,
        orderDate: "2026-10-06",
        storeId: "store-uuid-1",
      } as unknown as Awaited<ReturnType<typeof repositoryModule.submitDraft>>);

      const formData = new FormData();
      formData.set("storeId", "store-uuid-1");
      formData.set("orderDate", "2026-10-06");
      formData.set("version", "1");
      formData.set("allowRevision", "1");
      formData.append("productId", "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11");
      formData.append("stock", "1");
      formData.append("quantity", "3");

      const res = await submitOrderAction({}, formData);
      expect(res.status).toBe("success");
      expect(res.message).toBe("Pedido enviado — revisão 2.");
      expect(res.version).toBe(2);
      expect(submitDraftSpy).toHaveBeenCalledWith(storePrincipal, "store-uuid-1", "2026-10-06", true);
    });
  });

  describe("cancelOrderAction", () => {
    it("cancela pedido com sucesso chamando o repositório", async () => {
      const cancelSpy = vi.spyOn(repositoryModule, "cancelOrder").mockResolvedValue(
        { id: "order-1" } as unknown as Awaited<ReturnType<typeof repositoryModule.cancelOrder>>
      );

      const formData = new FormData();
      formData.set("orderId", "order-1");
      formData.set("reason", "Ajuste operacional");

      const res = await cancelOrderAction({}, formData);
      expect(res.status).toBe("success");
      expect(res.message).toBe("Pedido cancelado.");
      expect(cancelSpy).toHaveBeenCalledWith(storePrincipal, "order-1", "Ajuste operacional");
    });

    it("retorna erro amigável quando o cancelamento falha", async () => {
      vi.spyOn(repositoryModule, "cancelOrder").mockRejectedValue(new Error("Prazo de cancelamento expirado."));

      const formData = new FormData();
      formData.set("orderId", "order-1");

      const res = await cancelOrderAction({}, formData);
      expect(res.status).toBe("error");
      expect(res.message).toBe("Prazo de cancelamento expirado.");
    });
  });
});
