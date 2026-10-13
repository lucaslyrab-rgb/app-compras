import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  createSupplierAction,
  updateSupplierAction,
  toggleSupplierActiveAction,
} from "@/modules/suppliers/actions";
import * as sessionModule from "@/modules/identity/session";
import * as auditModule from "@/modules/identity/audit";
import * as repositoryModule from "@/modules/suppliers/repository";
import {
  SupplierConflictError,
  SupplierNotFoundError,
  SupplierValidationError,
  type Supplier,
} from "@/modules/suppliers/domain";
import type { Principal } from "@/modules/identity/domain";
import { revalidatePath } from "next/cache";

describe("Fornecedores - Server Actions e Autorização Granular", () => {
  const buyerPrincipal: Principal = {
    userId: "buyer-123",
    role: "COMPRADOR",
    storeId: null,
    permissions: ["compras:consolidado", "compras:custos", "compras:fornecedores"],
  };

  const managerPrincipal: Principal = {
    userId: "manager-456",
    role: "GESTOR",
    storeId: null,
    permissions: [
      "compras:fornecedores",
      "gestor:produtos",
      "gestor:precificacao",
      "gestor:fornecedores",
      "gestor:configuracoes",
      "gestor:usuarios",
    ],
  };

  const storePrincipal: Principal = {
    userId: "loja-789",
    role: "LOJA",
    storeId: "store-uuid",
    permissions: ["pedidos:criar", "pedidos:historico"],
  };

  const mockSupplier: Supplier = {
    id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    corporateName: "Distribuidora de Frutas Vitória Ltda",
    tradeName: "Frutas Vitória",
    taxId: "04252011000110",
    taxIdType: "CNPJ",
    taxInvoiceRule: "STANDARD",
    contactName: "Carlos",
    contactPhone: "27999991111",
    notes: "Entrega terças e sextas",
    active: true,
    version: 1,
    createdBy: "manager-456",
    updatedBy: "manager-456",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(auditModule, "recordAudit").mockResolvedValue(undefined as unknown as void);
  });

  describe("Bloqueio de perfil LOJA e usuários sem permissão", () => {
    it("nega createSupplierAction para perfil LOJA", async () => {
      vi.spyOn(sessionModule, "currentPrincipal").mockResolvedValue(storePrincipal);

      const res = await createSupplierAction({
        corporateName: "Tentativa Loja",
      });

      expect(res.status).toBe("error");
      expect(res.message).toMatch(/Acesso negado/);
    });

    it("nega updateSupplierAction para perfil LOJA", async () => {
      vi.spyOn(sessionModule, "currentPrincipal").mockResolvedValue(storePrincipal);

      const res = await updateSupplierAction({
        id: mockSupplier.id,
        corporateName: "Tentativa Loja",
        expectedVersion: 1,
      });

      expect(res.status).toBe("error");
      expect(res.message).toMatch(/Acesso negado/);
    });

    it("nega toggleSupplierActiveAction para perfil LOJA", async () => {
      vi.spyOn(sessionModule, "currentPrincipal").mockResolvedValue(storePrincipal);

      const res = await toggleSupplierActiveAction({
        id: mockSupplier.id,
        active: false,
        expectedVersion: 1,
      });

      expect(res.status).toBe("error");
      expect(res.message).toMatch(/Acesso negado/);
    });

    it("nega ações para requisições anônimas (sem sessão)", async () => {
      vi.spyOn(sessionModule, "currentPrincipal").mockResolvedValue(null);

      const res = await createSupplierAction({
        corporateName: "Anônimo",
      });

      expect(res.status).toBe("error");
      expect(res.message).toMatch(/Acesso negado/);
    });
  });

  describe("Perfil COMPRADOR (Pode cadastrar e editar, NÃO pode ativar/desativar)", () => {
    it("permite cadastrar fornecedor com compras:fornecedores", async () => {
      vi.spyOn(sessionModule, "currentPrincipal").mockResolvedValue(buyerPrincipal);
      const createSpy = vi.spyOn(repositoryModule, "createSupplier").mockResolvedValue(mockSupplier);

      const res = await createSupplierAction({
        corporateName: "Distribuidora de Frutas Vitória Ltda",
        tradeName: "Frutas Vitória",
        taxId: "04.252.011/0001-10",
        taxInvoiceRule: "STANDARD",
      });

      expect(res.status).toBe("success");
      if (res.status === "success") {
        expect(res.supplier.id).toBe(mockSupplier.id);
      }
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          corporateName: "Distribuidora de Frutas Vitória Ltda",
          actorId: buyerPrincipal.userId,
        })
      );
      expect(auditModule.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "SUPPLIER_CREATED",
          actorId: buyerPrincipal.userId,
          entityId: mockSupplier.id,
        })
      );
      expect(revalidatePath).toHaveBeenCalledWith("/comprador/fornecedores");
      expect(revalidatePath).toHaveBeenCalledWith("/gestor/fornecedores");
    });

    it("permite editar fornecedor com compras:fornecedores", async () => {
      vi.spyOn(sessionModule, "currentPrincipal").mockResolvedValue(buyerPrincipal);
      const updateSpy = vi.spyOn(repositoryModule, "updateSupplier").mockResolvedValue({
        ...mockSupplier,
        corporateName: "Nome Editado",
        version: 2,
      });

      const res = await updateSupplierAction({
        id: mockSupplier.id,
        corporateName: "Nome Editado",
        expectedVersion: 1,
      });

      expect(res.status).toBe("success");
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: mockSupplier.id,
          corporateName: "Nome Editado",
          expectedVersion: 1,
          actorId: buyerPrincipal.userId,
        })
      );
      expect(auditModule.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "SUPPLIER_UPDATED",
          actorId: buyerPrincipal.userId,
          entityId: mockSupplier.id,
        })
      );
    });

    it("BLOQUEIA Comprador ao tentar alternar situação ativo/inativo", async () => {
      vi.spyOn(sessionModule, "currentPrincipal").mockResolvedValue(buyerPrincipal);
      const toggleSpy = vi.spyOn(repositoryModule, "toggleSupplierActive");

      const res = await toggleSupplierActiveAction({
        id: mockSupplier.id,
        active: false,
        expectedVersion: 1,
      });

      expect(res.status).toBe("error");
      expect(res.message).toMatch(/apenas o perfil Gestor/i);
      expect(toggleSpy).not.toHaveBeenCalled();
      expect(auditModule.recordAudit).not.toHaveBeenCalled();
    });
  });

  describe("Perfil GESTOR (Acesso total incluindo ativar/desativar)", () => {
    it("permite desativar fornecedor", async () => {
      vi.spyOn(sessionModule, "currentPrincipal").mockResolvedValue(managerPrincipal);
      const toggleSpy = vi.spyOn(repositoryModule, "toggleSupplierActive").mockResolvedValue({
        ...mockSupplier,
        active: false,
        version: 2,
      });

      const res = await toggleSupplierActiveAction({
        id: mockSupplier.id,
        active: false,
        expectedVersion: 1,
      });

      expect(res.status).toBe("success");
      expect(toggleSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: mockSupplier.id,
          active: false,
          expectedVersion: 1,
          actorId: managerPrincipal.userId,
        })
      );
      expect(auditModule.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "SUPPLIER_DEACTIVATED",
          actorId: managerPrincipal.userId,
          entityId: mockSupplier.id,
        })
      );
      expect(revalidatePath).toHaveBeenCalledWith("/gestor/fornecedores");
      expect(revalidatePath).toHaveBeenCalledWith("/comprador/fornecedores");
    });

    it("permite reativar fornecedor", async () => {
      vi.spyOn(sessionModule, "currentPrincipal").mockResolvedValue(managerPrincipal);
      vi.spyOn(repositoryModule, "toggleSupplierActive").mockResolvedValue({
        ...mockSupplier,
        active: true,
        version: 3,
      });

      const res = await toggleSupplierActiveAction({
        id: mockSupplier.id,
        active: true,
        expectedVersion: 2,
      });

      expect(res.status).toBe("success");
      expect(auditModule.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "SUPPLIER_ACTIVATED",
          actorId: managerPrincipal.userId,
        })
      );
    });
  });

  describe("Tratamento de Erros de Domínio e Conflitos Otimistas", () => {
    it("retorna erro de validação amigável quando campos forem inválidos", async () => {
      vi.spyOn(sessionModule, "currentPrincipal").mockResolvedValue(managerPrincipal);

      const res = await createSupplierAction({
        corporateName: "", // inválido
      });

      expect(res.status).toBe("error");
      expect(res.message).toMatch(/razão social é obrigatória/i);
    });

    it("retorna erro de validação quando lançado pelo repositório", async () => {
      vi.spyOn(sessionModule, "currentPrincipal").mockResolvedValue(managerPrincipal);
      vi.spyOn(repositoryModule, "createSupplier").mockRejectedValue(
        new SupplierValidationError("Razão social inválida.")
      );

      const res = await createSupplierAction({
        corporateName: "Fornecedor Teste",
      });

      expect(res.status).toBe("error");
      expect(res.message).toBe("Razão social inválida.");
    });

    it("retorna erro de duplicidade de CNPJ/CPF quando lançado pelo repositório", async () => {
      vi.spyOn(sessionModule, "currentPrincipal").mockResolvedValue(managerPrincipal);
      vi.spyOn(repositoryModule, "createSupplier").mockRejectedValue(
        new SupplierConflictError("Já existe um fornecedor cadastrado com este CNPJ/CPF.")
      );

      const res = await createSupplierAction({
        corporateName: "Outro Fornecedor",
        taxId: "04.252.011/0001-10",
      });

      expect(res.status).toBe("error");
      expect(res.message).toBe("Já existe um fornecedor cadastrado com este CNPJ/CPF.");
    });

    it("retorna erro de concorrência otimista (versão desatualizada)", async () => {
      vi.spyOn(sessionModule, "currentPrincipal").mockResolvedValue(managerPrincipal);
      vi.spyOn(repositoryModule, "updateSupplier").mockRejectedValue(
        new SupplierConflictError(
          "O fornecedor foi modificado por outro usuário. Recarregue a página."
        )
      );

      const res = await updateSupplierAction({
        id: mockSupplier.id,
        corporateName: "Edição Concorrente",
        expectedVersion: 1,
      });

      expect(res.status).toBe("error");
      expect(res.message).toMatch(/modificado por outro usuário/i);
    });

    it("retorna erro quando fornecedor não for encontrado", async () => {
      vi.spyOn(sessionModule, "currentPrincipal").mockResolvedValue(managerPrincipal);
      vi.spyOn(repositoryModule, "toggleSupplierActive").mockRejectedValue(
        new SupplierNotFoundError("Fornecedor não encontrado.")
      );

      const res = await toggleSupplierActiveAction({
        id: mockSupplier.id,
        active: false,
        expectedVersion: 1,
      });

      expect(res.status).toBe("error");
      expect(res.message).toBe("Fornecedor não encontrado.");
    });
  });
});
