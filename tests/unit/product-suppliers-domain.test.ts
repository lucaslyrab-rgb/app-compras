import { describe, expect, it } from "vitest";
import {
  canManageProductSuppliers,
  canViewProductSuppliers,
  linkSupplierInputSchema,
  ProductSupplierConflictError,
  ProductSupplierNotFoundError,
  ProductSupplierValidationError,
  setPrimarySupplierInputSchema,
  toggleExclusivityInputSchema,
  unlinkSupplierInputSchema,
} from "@/modules/suppliers/product-suppliers-domain";
import type { Principal } from "@/modules/identity";

describe("Product Suppliers Domain - Validações e Regras de Negócio", () => {
  const validProductId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  const validSupplierId = "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22";

  describe("linkSupplierInputSchema", () => {
    it("aceita vínculo válido sem exclusividade", () => {
      const parsed = linkSupplierInputSchema.safeParse({
        productId: validProductId,
        supplierId: validSupplierId,
        isPrimary: true,
        isExclusive: false,
        notes: "Fornecedor principal de tomate",
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.productId).toBe(validProductId);
        expect(parsed.data.supplierId).toBe(validSupplierId);
        expect(parsed.data.isPrimary).toBe(true);
        expect(parsed.data.isExclusive).toBe(false);
      }
    });

    it("aceita vínculo com exclusividade quando também é principal", () => {
      const parsed = linkSupplierInputSchema.safeParse({
        productId: validProductId,
        supplierId: validSupplierId,
        isPrimary: true,
        isExclusive: true,
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.isPrimary).toBe(true);
        expect(parsed.data.isExclusive).toBe(true);
      }
    });

    it("rejeita exclusividade se não for definido como fornecedor principal", () => {
      const parsed = linkSupplierInputSchema.safeParse({
        productId: validProductId,
        supplierId: validSupplierId,
        isPrimary: false,
        isExclusive: true,
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0]?.message).toContain(
          "Um fornecedor só pode ser exclusivo se for o fornecedor principal"
        );
      }
    });

    it("rejeita UUIDs inválidos", () => {
      const invalidProduct = linkSupplierInputSchema.safeParse({
        productId: "invalid-uuid",
        supplierId: validSupplierId,
      });
      expect(invalidProduct.success).toBe(false);

      const invalidSupplier = linkSupplierInputSchema.safeParse({
        productId: validProductId,
        supplierId: "invalid-uuid",
      });
      expect(invalidSupplier.success).toBe(false);
    });

    it("converte strings vazias em notas para null", () => {
      const parsed = linkSupplierInputSchema.safeParse({
        productId: validProductId,
        supplierId: validSupplierId,
        notes: "   ",
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.notes).toBeNull();
      }
    });
  });

  describe("setPrimarySupplierInputSchema", () => {
    it("valida entradas corretas", () => {
      const parsed = setPrimarySupplierInputSchema.safeParse({
        productId: validProductId,
        supplierId: validSupplierId,
      });
      expect(parsed.success).toBe(true);
    });

    it("rejeita ids inválidos", () => {
      const parsed = setPrimarySupplierInputSchema.safeParse({
        productId: "123",
        supplierId: validSupplierId,
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe("toggleExclusivityInputSchema", () => {
    it("valida ativação de exclusividade", () => {
      const parsed = toggleExclusivityInputSchema.safeParse({
        productId: validProductId,
        supplierId: validSupplierId,
        isExclusive: true,
      });
      expect(parsed.success).toBe(true);
    });

    it("valida desativação de exclusividade", () => {
      const parsed = toggleExclusivityInputSchema.safeParse({
        productId: validProductId,
        supplierId: validSupplierId,
        isExclusive: false,
      });
      expect(parsed.success).toBe(true);
    });
  });

  describe("unlinkSupplierInputSchema", () => {
    it("valida desvinculação", () => {
      const parsed = unlinkSupplierInputSchema.safeParse({
        productId: validProductId,
        supplierId: validSupplierId,
      });
      expect(parsed.success).toBe(true);
    });
  });

  describe("Permissões de Acesso (RBAC)", () => {
    const gestorPrincipal: Principal = {
      userId: "user-1",
      role: "GESTOR",
      storeId: null,
      permissions: ["gestor:fornecedores", "gestor:produtos"],
    };

    const compradorPrincipal: Principal = {
      userId: "user-2",
      role: "COMPRADOR",
      storeId: null,
      permissions: ["compras:fornecedores", "compras:custos"],
    };

    const lojaPrincipal: Principal = {
      userId: "user-3",
      role: "LOJA",
      storeId: "store-1",
      permissions: ["pedidos:criar"],
    };

    it("permite que GESTOR visualize e gerencie vínculos", () => {
      expect(canViewProductSuppliers(gestorPrincipal)).toBe(true);
      expect(canManageProductSuppliers(gestorPrincipal)).toBe(true);
    });

    it("permite que COMPRADOR visualize e gerencie vínculos", () => {
      expect(canViewProductSuppliers(compradorPrincipal)).toBe(true);
      expect(canManageProductSuppliers(compradorPrincipal)).toBe(true);
    });

    it("impede que perfil LOJA visualize ou gerencie vínculos", () => {
      expect(canViewProductSuppliers(lojaPrincipal)).toBe(false);
      expect(canManageProductSuppliers(lojaPrincipal)).toBe(false);
    });
  });

  describe("Classes de Erro do Domínio", () => {
    it("ProductSupplierConflictError instancia corretamente", () => {
      const err = new ProductSupplierConflictError("Vínculo já existe");
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("ProductSupplierConflictError");
      expect(err.message).toBe("Vínculo já existe");
    });

    it("ProductSupplierNotFoundError instancia corretamente", () => {
      const err = new ProductSupplierNotFoundError("Produto não encontrado");
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("ProductSupplierNotFoundError");
      expect(err.message).toBe("Produto não encontrado");
    });

    it("ProductSupplierValidationError instancia corretamente", () => {
      const err = new ProductSupplierValidationError("Fornecedor inativo");
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("ProductSupplierValidationError");
      expect(err.message).toBe("Fornecedor inativo");
    });
  });
});
