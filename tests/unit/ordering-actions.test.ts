import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { saveDraftAction, submitOrderAction } from "@/modules/ordering/actions";
import * as sessionModule from "@/modules/identity/session";
import * as repositoryModule from "@/modules/ordering/repository";
import { OrderValidationError } from "@/modules/ordering/domain";
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
  });
});
