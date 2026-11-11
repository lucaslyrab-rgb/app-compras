/**
 * Armazenamento de fotos e notas numa pasta do computador, só para o ambiente
 * local de desenvolvimento (docs/desenvolvimento-local.md).
 *
 * Ativado por `LOCAL_STORAGE_DIR` e recusado em produção: lá as imagens ficam
 * sempre no S3. Devolve o mesmo formato que as rotas de imagem já leem do S3
 * (`Body.transformToWebStream`, `ContentLength`, erro `NoSuchKey`).
 */
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

export function localStorageRoot(env: Record<string, string | undefined> = process.env): string | null {
  const dir = env.LOCAL_STORAGE_DIR?.trim();
  if (!dir) return null;
  if (env.NODE_ENV === "production") {
    throw new Error("LOCAL_STORAGE_DIR é só para desenvolvimento local; em produção use o S3.");
  }
  return path.resolve(dir);
}

/** Caminho do arquivo, sem permitir sair da pasta do bucket. */
export function localObjectPath(root: string, bucket: string, key: string): string {
  const bucketDir = path.resolve(root, bucket);
  const target = path.resolve(bucketDir, key);
  if (!target.startsWith(bucketDir + path.sep)) {
    throw new Error("Chave de arquivo inválida.");
  }
  return target;
}

export async function putLocalObject(root: string, bucket: string, key: string, body: Buffer): Promise<void> {
  const target = localObjectPath(root, bucket, key);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(target, body);
}

export async function deleteLocalObject(root: string, bucket: string, key: string): Promise<void> {
  await fs.promises.rm(localObjectPath(root, bucket, key), { force: true });
}

export type LocalObject = {
  Body: { transformToWebStream: () => ReadableStream };
  ContentLength: number;
  ETag?: string;
};

export async function getLocalObject(root: string, bucket: string, key: string): Promise<LocalObject> {
  const target = localObjectPath(root, bucket, key);
  let size: number;
  try {
    size = (await fs.promises.stat(target)).size;
  } catch {
    // Mesmo erro do S3, para as rotas responderem 404 (ex.: foto que só existe em produção).
    throw Object.assign(new Error("Arquivo não encontrado no armazenamento local."), { name: "NoSuchKey" });
  }
  return {
    ContentLength: size,
    Body: {
      transformToWebStream: () => Readable.toWeb(fs.createReadStream(target)) as ReadableStream,
    },
  };
}
