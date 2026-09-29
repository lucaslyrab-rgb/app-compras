"use server";

import { revalidatePath } from "next/cache";
import { requirePrincipal } from "@/modules/identity/session";
import { recordAudit } from "@/modules/identity/audit";
import { z } from "zod";
import { ProductDraftConflictError, ProductVersionConflictError } from "./domain";
import { setProductActive } from "./repository";
import { uploadProductPhotoService, removeProductPhotoService } from "./service";
import { PhotoValidationError } from "@/lib/s3-photos";

const toggleSchema = z.object({ productId: z.uuid(), active: z.boolean(), expectedVersion: z.number().int().positive() });

export async function toggleProductAction(raw: unknown) {
  const principal = await requirePrincipal();
  const parsed = toggleSchema.safeParse(raw);
  if (!parsed.success) return { status: "error" as const, message: "Dados do produto inválidos." };
  try {
    const value = await setProductActive(principal, parsed.data.productId, parsed.data.active, parsed.data.expectedVersion);
    await recordAudit({ actorId: principal.userId, action: value.active ? "PRODUCT_ACTIVATED" : "PRODUCT_DEACTIVATED", entityType: "product", entityId: value.id, metadata: { version: value.version } });
    revalidatePath("/");
    revalidatePath("/gestor/produtos");
    revalidatePath("/gestor/precificacao");
    revalidatePath("/comprador/consolidado");
    revalidatePath("/comprador/custos");
    return { status: "success" as const, value };
  } catch (error) {
    if (error instanceof ProductDraftConflictError || error instanceof ProductVersionConflictError)
      return { status: "error" as const, message: error.message };
    return { status: "error" as const, message: "Não foi possível alterar o status do produto." };
  }
}

export async function uploadProductPhotoAction(formData: FormData) {
  const principal = await requirePrincipal();
  const productId = formData.get("productId") as string;
  const expectedVersion = Number(formData.get("expectedVersion"));
  const file = formData.get("file") as File;

  if (!productId || !z.string().uuid().safeParse(productId).success) {
    return { status: "error" as const, message: "ID de produto inválido." };
  }
  if (!Number.isInteger(expectedVersion) || expectedVersion <= 0) {
    return { status: "error" as const, message: "Versão do produto inválida." };
  }
  if (!file || typeof file.arrayBuffer !== "function") {
    return { status: "error" as const, message: "Arquivo de foto obrigatório." };
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const value = await uploadProductPhotoService(principal, productId, buffer, expectedVersion);

    await recordAudit({
      actorId: principal.userId,
      action: "PRODUCT_PHOTO_UPDATED",
      entityType: "product",
      entityId: value.id,
      metadata: { version: value.version, photoKey: value.photoKey },
    });

    revalidatePath("/");
    revalidatePath("/gestor/produtos");
    revalidatePath("/gestor/precificacao");
    revalidatePath("/comprador/consolidado");
    revalidatePath("/comprador/custos");

    return { status: "success" as const, value };
  } catch (error) {
    if (error instanceof ProductVersionConflictError) {
      return { status: "conflict" as const, message: error.message };
    }
    if (error instanceof PhotoValidationError) {
      return { status: "error" as const, message: error.message };
    }
    return {
      status: "error" as const,
      message: error instanceof Error ? error.message : "Não foi possível enviar a foto do produto.",
    };
  }
}

export async function removeProductPhotoAction(input: { productId: string; expectedVersion: number }) {
  const principal = await requirePrincipal();
  const { productId, expectedVersion } = input;

  if (!productId || !z.string().uuid().safeParse(productId).success) {
    return { status: "error" as const, message: "ID de produto inválido." };
  }
  if (!Number.isInteger(expectedVersion) || expectedVersion <= 0) {
    return { status: "error" as const, message: "Versão do produto inválida." };
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

    revalidatePath("/");
    revalidatePath("/gestor/produtos");
    revalidatePath("/gestor/precificacao");
    revalidatePath("/comprador/consolidado");
    revalidatePath("/comprador/custos");

    return { status: "success" as const, value };
  } catch (error) {
    if (error instanceof ProductVersionConflictError) {
      return { status: "conflict" as const, message: error.message };
    }
    return {
      status: "error" as const,
      message: error instanceof Error ? error.message : "Não foi possível remover a foto do produto.",
    };
  }
}

