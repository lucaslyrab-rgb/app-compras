import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { GetObjectCommandOutput } from "@aws-sdk/client-s3";
import type { Principal } from "@/modules/identity";
import type { InvoiceRecord } from "@/modules/purchasing/invoices/domain";

vi.mock("server-only", () => ({}));

import { GET } from "@/app/api/invoices/[id]/image/route";
import * as session from "@/modules/identity/session";
import * as invoices from "@/modules/purchasing/invoices/repository";
import * as s3Invoices from "@/lib/s3-invoices";

const invoice: InvoiceRecord = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  purchaseCycleDate: "2026-10-27",
  storeId: "store-ponta",
  supplierId: "supplier-1",
  invoiceNumber: "NF-123",
  imageS3Key: "invoices/private.webp",
  contentType: "image/webp",
  fileSizeBytes: 15,
  createdAt: "2026-10-27T12:00:00Z",
  updatedAt: "2026-10-27T12:00:00Z",
};

function requestImage() {
  return GET(new NextRequest(`https://example.test/api/invoices/${invoice.id}/image`), {
    params: Promise.resolve({ id: invoice.id }),
  });
}

describe("fotografia de nota fiscal — autorização e troca de sessão", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(session, "currentPrincipal").mockResolvedValue(null);
    vi.spyOn(invoices, "getInvoiceById").mockResolvedValue(invoice);
    vi.spyOn(s3Invoices, "getInvoiceFromS3").mockImplementation(async () => ({
      $metadata: { httpStatusCode: 200 },
      Body: {
        transformToWebStream: () => new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("private-invoice"));
            controller.close();
          },
        }),
      } as GetObjectCommandOutput["Body"],
      ContentLength: 15,
    }));
  });

  it("rejeita acesso sem sessão antes de consultar a nota ou o armazenamento", async () => {
    const response = await requestImage();
    expect(response.status).toBe(401);
    expect(invoices.getInvoiceById).not.toHaveBeenCalled();
    expect(s3Invoices.getInvoiceFromS3).not.toHaveBeenCalled();
  });

  it.each<Principal>([
    { userId: "user-1", role: "COMPRADOR", storeId: null, permissions: [] },
    { userId: "user-1", role: "GESTOR", storeId: null, permissions: ["gestor:produtos"] },
    { userId: "user-1", role: "LOJA", storeId: "store-balneario", permissions: ["pedidos:historico"] },
    { userId: "user-1", role: "LOJA", storeId: "store-ponta", permissions: [] },
  ])("nega acesso sem permissão ou à nota de outra loja: %j", async (principal) => {
    vi.mocked(session.currentPrincipal).mockResolvedValue(principal);
    const response = await requestImage();
    expect(response.status).toBe(403);
    expect(s3Invoices.getInvoiceFromS3).not.toHaveBeenCalled();
  });

  it.each<Principal>([
    { userId: "user-1", role: "COMPRADOR", storeId: null, permissions: ["compras:destinacao"] },
    { userId: "user-1", role: "COMPRADOR", storeId: null, permissions: ["compras:fornecedores"] },
    { userId: "user-1", role: "GESTOR", storeId: null, permissions: ["gestor:fornecedores"] },
    { userId: "user-1", role: "LOJA", storeId: "store-ponta", permissions: ["pedidos:historico"] },
  ])("entrega a imagem sem armazenamento em cache ao usuário autorizado: %j", async (principal) => {
    vi.mocked(session.currentPrincipal).mockResolvedValue(principal);
    const response = await requestImage();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).toBe("private-invoice");
    expect(s3Invoices.getInvoiceFromS3).toHaveBeenCalledWith(invoice.imageS3Key);
  });

  it("revalida a autorização após logout e entrada de usuário de outra loja", async () => {
    vi.mocked(session.currentPrincipal)
      .mockResolvedValueOnce({ userId: "buyer", role: "COMPRADOR", storeId: null, permissions: ["compras:destinacao"] })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ userId: "store-user", role: "LOJA", storeId: "store-balneario", permissions: ["pedidos:historico"] });

    const authorized = await requestImage();
    expect(authorized.status).toBe(200);
    expect(authorized.headers.get("Cache-Control")).toContain("no-store");
    expect((await requestImage()).status).toBe(401);
    expect((await requestImage()).status).toBe(403);
    expect(s3Invoices.getInvoiceFromS3).toHaveBeenCalledTimes(1);
  });
});
