import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { database } from "@/db/client";
import { currentPrincipal } from "@/modules/identity/session";
import { canManageProducts } from "@/modules/identity";
import { recordAudit } from "@/modules/identity/audit";
import { getPhotoFromS3, PhotoValidationError } from "@/lib/s3-photos";
import { uploadProductPhotoService, removeProductPhotoService } from "@/modules/catalog/service";
import { ProductVersionConflictError } from "@/modules/catalog/domain";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const principal = await currentPrincipal();
  if (!principal) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const { id: productId } = await params;
  if (!z.string().uuid().safeParse(productId).success) {
    return NextResponse.json({ error: "ID de produto inválido." }, { status: 400 });
  }

  // Consulta photo_key e photo_updated_at no banco
  const [product] = await database().sql<
    { photo_key: string | null; photo_updated_at: Date | null }[]
  >`
    SELECT photo_key, photo_updated_at FROM products WHERE id = ${productId}
  `;

  if (!product || !product.photo_key) {
    return NextResponse.json({ error: "Foto não encontrada." }, { status: 404 });
  }

  try {
    const s3Response = await getPhotoFromS3(product.photo_key);
    if (!s3Response.Body) {
      return NextResponse.json({ error: "Objeto vazio." }, { status: 404 });
    }

    const searchParams = request.nextUrl.searchParams;
    const hasVersionParam = Boolean(searchParams.get("v"));

    const headers = new Headers();
    headers.set("Content-Type", "image/webp");

    if (hasVersionParam) {
      // URL versionada com cache busting: cache longo e imutável
      headers.set("Cache-Control", "private, max-age=31536000, immutable");
    } else {
      headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate");
    }

    if (s3Response.ContentLength) {
      headers.set("Content-Length", String(s3Response.ContentLength));
    }
    if (s3Response.ETag) {
      headers.set("ETag", s3Response.ETag);
    }

    // Body stream compatível com Web Streams
    const bodyStream = s3Response.Body.transformToWebStream();
    return new Response(bodyStream, {
      status: 200,
      headers,
    });
  } catch (err: unknown) {
    const isNoSuchKey =
      (err as { name?: string })?.name === "NoSuchKey" ||
      (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404;

    if (isNoSuchKey) {
      return NextResponse.json(
        { error: "Foto não encontrada no armazenamento." },
        { status: 404 }
      );
    }

    console.error(
      "[S3_GET_PHOTO_ERROR]",
      (err as Error)?.message?.replace(/AKIA[0-9A-Z]{16}/g, "[KEY]")
    );

    return NextResponse.json(
      { error: "Erro ao recuperar a foto do produto." },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const principal = await currentPrincipal();
  if (!principal) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  if (!canManageProducts(principal)) {
    return NextResponse.json(
      { error: "Somente o Gestor pode gerenciar fotos de produtos." },
      { status: 403 }
    );
  }

  const { id: productId } = await params;
  if (!z.string().uuid().safeParse(productId).success) {
    return NextResponse.json({ error: "ID de produto inválido." }, { status: 400 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Formulário multipart inválido." }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  const expectedVersion = Number(formData.get("expectedVersion"));

  if (!file || typeof file.arrayBuffer !== "function") {
    return NextResponse.json({ error: "Arquivo de foto obrigatório." }, { status: 400 });
  }

  if (!Number.isInteger(expectedVersion) || expectedVersion <= 0) {
    return NextResponse.json({ error: "Versão do produto inválida." }, { status: 400 });
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const value = await uploadProductPhotoService(
      principal,
      productId,
      buffer,
      expectedVersion
    );

    await recordAudit({
      actorId: principal.userId,
      action: "PRODUCT_PHOTO_UPDATED",
      entityType: "product",
      entityId: value.id,
      metadata: { version: value.version, photoKey: value.photoKey },
    });

    return NextResponse.json({ status: "success", value }, { status: 200 });
  } catch (error) {
    if (error instanceof ProductVersionConflictError) {
      return NextResponse.json({ status: "conflict", message: error.message }, { status: 409 });
    }
    if (error instanceof PhotoValidationError) {
      return NextResponse.json({ status: "error", message: error.message }, { status: 400 });
    }
    return NextResponse.json(
      {
        status: "error",
        message: error instanceof Error ? error.message : "Erro ao processar upload da foto.",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const principal = await currentPrincipal();
  if (!principal) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  if (!canManageProducts(principal)) {
    return NextResponse.json(
      { error: "Somente o Gestor pode remover fotos de produtos." },
      { status: 403 }
    );
  }

  const { id: productId } = await params;
  if (!z.string().uuid().safeParse(productId).success) {
    return NextResponse.json({ error: "ID de produto inválido." }, { status: 400 });
  }

  let expectedVersion: number | undefined;

  // Pode vir por query parameter ou corpo JSON
  const versionParam = request.nextUrl.searchParams.get("expectedVersion");
  if (versionParam) {
    expectedVersion = Number(versionParam);
  } else {
    try {
      const body = await request.json();
      expectedVersion = Number(body?.expectedVersion);
    } catch {
      // Ignora erro de JSON
    }
  }

  if (!expectedVersion || !Number.isInteger(expectedVersion) || expectedVersion <= 0) {
    return NextResponse.json({ error: "Versão do produto inválida." }, { status: 400 });
  }

  try {
    const value = await removeProductPhotoService(principal, productId, expectedVersion);

    await recordAudit({
      actorId: principal.userId,
      action: "PRODUCT_PHOTO_REMOVED",
      entityType: "product",
      entityId: value.id,
      metadata: { version: value.version },
    });

    return NextResponse.json({ status: "success", value }, { status: 200 });
  } catch (error) {
    if (error instanceof ProductVersionConflictError) {
      return NextResponse.json({ status: "conflict", message: error.message }, { status: 409 });
    }
    return NextResponse.json(
      {
        status: "error",
        message: error instanceof Error ? error.message : "Erro ao remover a foto do produto.",
      },
      { status: 500 }
    );
  }
}
