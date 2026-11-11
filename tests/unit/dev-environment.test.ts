import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { assertLocalDatabaseUrl, databaseName } from "@/lib/dev-safety";
import {
  deleteLocalObject,
  getLocalObject,
  localObjectPath,
  localStorageRoot,
  putLocalObject,
} from "@/lib/local-object-storage";

describe("trava do ambiente local", () => {
  it("aceita só banco no próprio computador", () => {
    expect(assertLocalDatabaseUrl("postgres://postgres:x@localhost:5433/app_compras").port).toBe("5433");
    expect(() => assertLocalDatabaseUrl("postgres://postgres:x@127.0.0.1:5433/app_compras")).not.toThrow();
    expect(() => assertLocalDatabaseUrl("postgres://app:x@postgres:5432/app_compras")).toThrow(/só roda no banco local/);
    expect(() => assertLocalDatabaseUrl("postgres://app:x@db.muitomaisatacado.com/app_compras")).toThrow(/só roda no banco local/);
    expect(() => assertLocalDatabaseUrl(undefined)).toThrow(/DATABASE_URL não definido/);
    expect(() => assertLocalDatabaseUrl("não é url")).toThrow(/inválido/);
  });

  it("lê o nome do banco e recusa nomes estranhos", () => {
    expect(databaseName(new URL("postgres://u:p@localhost:5433/app_compras"))).toBe("app_compras");
    expect(() => databaseName(new URL('postgres://u:p@localhost:5433/x";drop'))).toThrow(/inválido/);
  });
});

describe("armazenamento local de fotos e notas", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "app-compras-storage-"));
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it("só é ativado por LOCAL_STORAGE_DIR e nunca em produção", () => {
    expect(localStorageRoot({})).toBeNull();
    expect(localStorageRoot({ LOCAL_STORAGE_DIR: ".local-storage", NODE_ENV: "development" })).toBe(
      path.resolve(".local-storage"),
    );
    expect(() => localStorageRoot({ LOCAL_STORAGE_DIR: ".local-storage", NODE_ENV: "production" })).toThrow(/produção/);
  });

  it("não deixa a chave sair da pasta do bucket", () => {
    expect(localObjectPath(root, "compras-notas", "invoices/2026-11-11/a.webp")).toBe(
      path.join(root, "compras-notas", "invoices", "2026-11-11", "a.webp"),
    );
    expect(() => localObjectPath(root, "compras-notas", "../compras-img/x.webp")).toThrow(/inválida/);
  });

  it("grava, lê e apaga como o S3; arquivo ausente vira NoSuchKey", async () => {
    await putLocalObject(root, "compras-img", "products/p1/f.webp", Buffer.from("foto"));
    const object = await getLocalObject(root, "compras-img", "products/p1/f.webp");
    expect(object.ContentLength).toBe(4);
    const text = await new Response(object.Body.transformToWebStream()).text();
    expect(text).toBe("foto");

    await deleteLocalObject(root, "compras-img", "products/p1/f.webp");
    await expect(getLocalObject(root, "compras-img", "products/p1/f.webp")).rejects.toMatchObject({ name: "NoSuchKey" });
    await expect(deleteLocalObject(root, "compras-img", "products/p1/f.webp")).resolves.toBeUndefined();
  });
});
