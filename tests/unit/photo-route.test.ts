import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
import { NextRequest } from "next/server";
import type { GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { GET, POST, DELETE } from "@/app/api/products/[id]/photo/route";
import * as session from "@/modules/identity/session";
import * as dbClient from "@/db/client";
import * as s3Photos from "@/lib/s3-photos";
import * as catalogService from "@/modules/catalog/service";
import * as audit from "@/modules/identity/audit";
import { ProductVersionConflictError } from "@/modules/catalog/domain";

describe("API Route - /api/products/[id]/photo", () => {
  const validUuid = "123e4567-e89b-12d3-a456-426614174000";

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(audit, "recordAudit").mockResolvedValue(undefined);
  });

  describe("GET /api/products/[id]/photo", () => {
    it("retorna 401 quando não autenticado", async () => {
      vi.spyOn(session, "currentPrincipal").mockResolvedValue(null);
      const req = new NextRequest(`http://localhost:3000/api/products/${validUuid}/photo`);
      const res = await GET(req, { params: Promise.resolve({ id: validUuid }) });
      expect(res.status).toBe(401);
    });

    it("retorna 400 para UUID de produto inválido", async () => {
      vi.spyOn(session, "currentPrincipal").mockResolvedValue({
        userId: "user-1",
        role: "LOJA",
        storeId: "store-1",
        permissions: ["pedidos:criar", "pedidos:historico"],
      });
      const req = new NextRequest("http://localhost:3000/api/products/invalid-uuid/photo");
      const res = await GET(req, { params: Promise.resolve({ id: "invalid-uuid" }) });
      expect(res.status).toBe(400);
    });

    it("retorna 404 quando o produto não possui foto no banco", async () => {
      vi.spyOn(session, "currentPrincipal").mockResolvedValue({
        userId: "user-1",
        role: "LOJA",
        storeId: "store-1",
        permissions: ["pedidos:criar", "pedidos:historico"],
      });
      const mockSql = vi.fn().mockResolvedValue([]);
      vi.spyOn(dbClient, "database").mockReturnValue({ sql: mockSql } as unknown as ReturnType<typeof dbClient.database>);

      const req = new NextRequest(`http://localhost:3000/api/products/${validUuid}/photo`);
      const res = await GET(req, { params: Promise.resolve({ id: validUuid }) });
      expect(res.status).toBe(404);
    });

    it("retorna 200 com WebP e Cache-Control imutável quando v= está presente", async () => {
      vi.spyOn(session, "currentPrincipal").mockResolvedValue({
        userId: "user-1",
        role: "COMPRADOR",
        storeId: null,
        permissions: ["compras:consolidado", "compras:custos"],
      });

      const mockSql = vi.fn().mockResolvedValue([
        { photo_key: `products/${validUuid}/photo.webp`, photo_updated_at: new Date() },
      ]);
      vi.spyOn(dbClient, "database").mockReturnValue({ sql: mockSql } as unknown as ReturnType<typeof dbClient.database>);

      const fakeStream = new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from("fake-webp-data"));
          controller.close();
        },
      });

      vi.spyOn(s3Photos, "getPhotoFromS3").mockResolvedValue({
        Body: {
          transformToWebStream: () => fakeStream,
        } as unknown as GetObjectCommandOutput["Body"],
        ContentLength: 14,
        ETag: '"test-etag"',
      } as unknown as GetObjectCommandOutput);

      const req = new NextRequest(`http://localhost:3000/api/products/${validUuid}/photo?v=1700000000`);
      const res = await GET(req, { params: Promise.resolve({ id: validUuid }) });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/webp");
      expect(res.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
      expect(res.headers.get("ETag")).toBe('"test-etag"');
    });

    it("permite GET para qualquer usuário autenticado independentemente de role ou permissões", async () => {
      vi.spyOn(session, "currentPrincipal").mockResolvedValue({
        userId: "user-qualquer",
        role: "COMPRADOR",
        storeId: null,
        permissions: [],
      });

      const mockSql = vi.fn().mockResolvedValue([
        { photo_key: `products/${validUuid}/photo.webp`, photo_updated_at: new Date() },
      ]);
      vi.spyOn(dbClient, "database").mockReturnValue({ sql: mockSql } as unknown as ReturnType<typeof dbClient.database>);

      const fakeStream = new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from("fake-webp-data"));
          controller.close();
        },
      });

      vi.spyOn(s3Photos, "getPhotoFromS3").mockResolvedValue({
        Body: {
          transformToWebStream: () => fakeStream,
        } as unknown as GetObjectCommandOutput["Body"],
        ContentLength: 14,
        ETag: '"test-etag"',
      } as unknown as GetObjectCommandOutput);

      const req = new NextRequest(`http://localhost:3000/api/products/${validUuid}/photo`);
      const res = await GET(req, { params: Promise.resolve({ id: validUuid }) });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/webp");
    });
  });

  describe("POST /api/products/[id]/photo", () => {
    it("retorna 403 para usuário sem permissão gestor:produtos (mesmo sendo GESTOR)", async () => {
      vi.spyOn(session, "currentPrincipal").mockResolvedValue({
        userId: "gestor-sem-produtos",
        role: "GESTOR",
        storeId: null,
        permissions: ["gestor:precificacao"],
      });

      const formData = new FormData();
      formData.append("expectedVersion", "1");
      formData.append("file", new File(["test"], "test.png", { type: "image/png" }));

      const req = new NextRequest(`http://localhost:3000/api/products/${validUuid}/photo`, {
        method: "POST",
        body: formData,
      });

      const res = await POST(req, { params: Promise.resolve({ id: validUuid }) });
      expect(res.status).toBe(403);
    });

    it("retorna 200 para usuário com role != GESTOR mas que possui gestor:produtos", async () => {
      vi.spyOn(session, "currentPrincipal").mockResolvedValue({
        userId: "comprador-com-permissao",
        role: "COMPRADOR",
        storeId: null,
        permissions: ["compras:consolidado", "gestor:produtos"],
      });

      vi.spyOn(catalogService, "uploadProductPhotoService").mockResolvedValue({
        id: validUuid,
        version: 2,
        photoKey: `products/${validUuid}/photo.webp`,
        photoUpdatedAt: new Date().toISOString(),
      });

      const formData = new FormData();
      formData.append("expectedVersion", "1");
      formData.append("file", new File(["test"], "test.png", { type: "image/png" }));

      const req = new NextRequest(`http://localhost:3000/api/products/${validUuid}/photo`, {
        method: "POST",
        body: formData,
      });

      const res = await POST(req, { params: Promise.resolve({ id: validUuid }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("success");
      expect(json.value.photoKey).toBe(`products/${validUuid}/photo.webp`);
    });

    it("retorna 409 em caso de conflito de versão otimista", async () => {
      vi.spyOn(session, "currentPrincipal").mockResolvedValue({
        userId: "gestor-1",
        role: "GESTOR",
        storeId: null,
        permissions: ["gestor:produtos"],
      });

      vi.spyOn(catalogService, "uploadProductPhotoService").mockRejectedValue(
        new ProductVersionConflictError()
      );

      const formData = new FormData();
      formData.append("expectedVersion", "1");
      formData.append("file", new File(["test"], "test.png", { type: "image/png" }));

      const req = new NextRequest(`http://localhost:3000/api/products/${validUuid}/photo`, {
        method: "POST",
        body: formData,
      });

      const res = await POST(req, { params: Promise.resolve({ id: validUuid }) });
      expect(res.status).toBe(409);
    });
  });

  describe("DELETE /api/products/[id]/photo", () => {
    it("retorna 403 para usuário sem permissão gestor:produtos (mesmo sendo GESTOR)", async () => {
      vi.spyOn(session, "currentPrincipal").mockResolvedValue({
        userId: "gestor-sem-produtos",
        role: "GESTOR",
        storeId: null,
        permissions: ["gestor:precificacao"],
      });

      const req = new NextRequest(`http://localhost:3000/api/products/${validUuid}/photo?expectedVersion=1`, {
        method: "DELETE",
      });

      const res = await DELETE(req, { params: Promise.resolve({ id: validUuid }) });
      expect(res.status).toBe(403);
    });

    it("retorna 200 ao remover foto com usuário role != GESTOR que possui gestor:produtos", async () => {
      vi.spyOn(session, "currentPrincipal").mockResolvedValue({
        userId: "comprador-com-permissao",
        role: "COMPRADOR",
        storeId: null,
        permissions: ["compras:consolidado", "gestor:produtos"],
      });

      vi.spyOn(catalogService, "removeProductPhotoService").mockResolvedValue({
        id: validUuid,
        version: 2,
        photoKey: null,
        photoUpdatedAt: null,
      });

      const req = new NextRequest(`http://localhost:3000/api/products/${validUuid}/photo?expectedVersion=1`, {
        method: "DELETE",
      });

      const res = await DELETE(req, { params: Promise.resolve({ id: validUuid }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("success");
      expect(json.value.photoKey).toBeNull();
    });

    it("retorna 200 ao remover foto com perfil GESTOR", async () => {
      vi.spyOn(session, "currentPrincipal").mockResolvedValue({
        userId: "gestor-1",
        role: "GESTOR",
        storeId: null,
        permissions: ["gestor:produtos"],
      });

      vi.spyOn(catalogService, "removeProductPhotoService").mockResolvedValue({
        id: validUuid,
        version: 2,
        photoKey: null,
        photoUpdatedAt: null,
      });

      const req = new NextRequest(`http://localhost:3000/api/products/${validUuid}/photo?expectedVersion=1`, {
        method: "DELETE",
      });

      const res = await DELETE(req, { params: Promise.resolve({ id: validUuid }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("success");
      expect(json.value.photoKey).toBeNull();
    });
  });
});
