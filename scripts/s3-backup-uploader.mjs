#!/usr/bin/env node
/**
 * s3-backup-uploader.mjs
 *
 * Envia artefato de backup criptografado (.dump.age e .dump.age.sha256)
 * para o bucket S3 de backup (compras-bkp) utilizando AWS Signature Version 4 (SigV4).
 *
 * Zero dependências externas (utiliza Node.js crypto e fetch nativos).
 * Credenciais lidas exclusivamente de /run/secrets/ ou variáveis de ambiente de teste.
 * NUNCA imprime credenciais em logs ou stdout/stderr.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function readSecret(envVar, fileSecretPath) {
  if (process.env[envVar]) {
    return process.env[envVar].trim();
  }
  if (fileSecretPath && fs.existsSync(fileSecretPath)) {
    return fs.readFileSync(fileSecretPath, "utf8").trim();
  }
  return null;
}

const accessKeyId = readSecret(
  "AWS_ACCESS_KEY_ID",
  "/run/secrets/app_compras_s3_backup_access_key_id"
);
const secretAccessKey = readSecret(
  "AWS_SECRET_ACCESS_KEY",
  "/run/secrets/app_compras_s3_backup_secret_access_key"
);

const bucket = process.env.S3_BUCKET || "compras-bkp";
const region = process.env.S3_REGION || "us-east-1";
const archivesDir = process.env.ARCHIVES_DIR || "/archives";
const s3Prefix = process.env.S3_PREFIX ? process.env.S3_PREFIX.replace(/^\/|\/$/g, "") + "/" : "";
const host = `${bucket}.s3.${region}.amazonaws.com`;

if (!accessKeyId || !secretAccessKey) {
  console.error("[ERRO] Credenciais S3 ausentes. Verifique se os Docker Secrets ou variáveis foram fornecidos.");
  process.exit(1);
}

const archiveName = process.argv[2];
if (!archiveName) {
  console.error("[ERRO] Nome do artefato de backup não informado como argumento.");
  console.error("Uso: node s3-backup-uploader.mjs <arquivo.dump.age>");
  process.exit(1);
}

const archivePath = path.join(archivesDir, archiveName);
const shaPath = path.join(archivesDir, `${archiveName}.sha256`);

if (!fs.existsSync(archivePath)) {
  console.error(`[ERRO] Arquivo de backup local não encontrado: ${archivePath}`);
  process.exit(1);
}
if (!fs.existsSync(shaPath)) {
  console.error(`[ERRO] Arquivo de checksum local não encontrado: ${shaPath}`);
  process.exit(1);
}

function hmac(key, string) {
  return crypto.createHmac("sha256", key).update(string).digest();
}

function hash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function getSigningKey(secretKey, dateStamp, reg, service) {
  const kDate = hmac("AWS4" + secretKey, dateStamp);
  const kRegion = hmac(kDate, reg);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  return kSigning;
}

async function s3Request({ method, objectKey, headers = {}, body = Buffer.alloc(0) }) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.substring(0, 8);
  const payloadHash = hash(body);

  const normalizedPath = `/${objectKey.replace(/^\//, "")}`;

  const reqHeaders = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...headers,
  };

  const signedHeaderKeys = Object.keys(reqHeaders).map((k) => k.toLowerCase()).sort();
  const signedHeadersStr = signedHeaderKeys.join(";");
  const canonicalHeaders = signedHeaderKeys.map((k) => `${k}:${reqHeaders[k]}\n`).join("");

  const canonicalRequest = [
    method,
    encodeURI(normalizedPath),
    "", // query string
    canonicalHeaders,
    signedHeadersStr,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    hash(Buffer.from(canonicalRequest, "utf8")),
  ].join("\n");

  const signingKey = getSigningKey(secretAccessKey, dateStamp, region, "s3");
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  reqHeaders["Authorization"] = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`;

  const res = await fetch(`https://${host}${encodeURI(normalizedPath)}`, {
    method,
    headers: reqHeaders,
    body: method !== "GET" && method !== "HEAD" && body.length > 0 ? body : undefined,
  });

  return res;
}

async function uploadFile(localPath, remoteKey, contentType) {
  const content = fs.readFileSync(localPath);
  const sizeBytes = content.length;
  console.log(`[UPLOAD] Enviando ${path.basename(localPath)} (${sizeBytes} bytes) para s3://${bucket}/${remoteKey}...`);

  const putRes = await s3Request({
    method: "PUT",
    objectKey: remoteKey,
    headers: {
      "content-type": contentType,
      "content-length": String(sizeBytes),
    },
    body: content,
  });

  if (putRes.status !== 200) {
    const errorBody = await putRes.text();
    throw new Error(`Upload falhou com HTTP ${putRes.status}: ${errorBody.slice(0, 300)}`);
  }

  // Confirmação remota via HEAD
  const headRes = await s3Request({
    method: "HEAD",
    objectKey: remoteKey,
  });

  if (headRes.status !== 200) {
    throw new Error(`Verificação remota (HEAD) de s3://${bucket}/${remoteKey} retornou HTTP ${headRes.status}`);
  }

  console.log(`[VERIFICADO] Objeto s3://${bucket}/${remoteKey} confirmado remotamente.`);
}

async function main() {
  const remoteArchiveKey = `${s3Prefix}${archiveName}`;
  const remoteShaKey = `${s3Prefix}${archiveName}.sha256`;

  await uploadFile(archivePath, remoteArchiveKey, "application/octet-stream");
  await uploadFile(shaPath, remoteShaKey, "text/plain");

  console.log("[SUCESSO] Upload do backup e checksum concluído e validado no S3.");
}

main().catch((err) => {
  console.error(`[FALHA_S3] ${err.message.replace(/AKIA[0-9A-Z]{16}/g, "[KEY]")}`);
  process.exit(1);
});
