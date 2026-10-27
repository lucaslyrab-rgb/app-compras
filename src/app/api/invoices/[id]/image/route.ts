import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentPrincipal } from "@/modules/identity/session";
import { hasAnyPermission } from "@/modules/identity";
import { getInvoiceById } from "@/modules/purchasing/invoices/repository";
import { getInvoiceFromS3 } from "@/lib/s3-invoices";
import { log } from "@/shared/logging";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const principal = await currentPrincipal();
  if (!principal) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const { id: invoiceId } = await params;
  if (!z.string().uuid().safeParse(invoiceId).success) {
    return NextResponse.json({ error: "ID de nota fiscal inválido." }, { status: 400 });
  }

  const invoice = await getInvoiceById(invoiceId);
  if (!invoice) {
    return NextResponse.json({ error: "Nota fiscal não encontrada." }, { status: 404 });
  }

  // Política de autorização explícita:
  // - Usuários LOJA: devem pertencer à loja da nota E possuir permissão de histórico/pedidos
  // - Usuários COMPRADOR/GESTOR: devem possuir permissão explícita de destinação ou fornecedores
  let isAuthorized = false;
  if (principal.role === "LOJA") {
    isAuthorized =
      principal.storeId === invoice.storeId &&
      hasAnyPermission(principal, ["pedidos:historico", "pedidos:criar"]);
  } else if (principal.role === "COMPRADOR" || principal.role === "GESTOR") {
    isAuthorized = hasAnyPermission(principal, [
      "compras:destinacao",
      "compras:fornecedores",
      "gestor:fornecedores",
    ]);
  }

  if (!isAuthorized) {
    return NextResponse.json(
      { error: "Acesso negado para visualização deste documento fiscal." },
      { status: 403 }
    );
  }

  try {
    const s3Response = await getInvoiceFromS3(invoice.imageS3Key);
    if (!s3Response.Body) {
      return NextResponse.json({ error: "Imagem vazia ou não encontrada." }, { status: 404 });
    }

    const headers = new Headers();
    headers.set("Content-Type", invoice.contentType || "image/webp");
    headers.set("Cache-Control", "private, no-store");

    if (s3Response.ContentLength) {
      headers.set("Content-Length", String(s3Response.ContentLength));
    }
    if (s3Response.ETag) {
      headers.set("ETag", s3Response.ETag);
    }

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
        { error: "Arquivo de fotografia não encontrado no armazenamento." },
        { status: 404 }
      );
    }

    log.error({
      event: "S3_GET_INVOICE_IMAGE_ERROR",
      invoiceId,
      error: err instanceof Error ? err.message : String(err),
    });

    return NextResponse.json(
      { error: "Erro ao recuperar fotografia da nota fiscal." },
      { status: 500 }
    );
  }
}
