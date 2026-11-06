/**
 * Redução de fotos no próprio celular antes do envio.
 *
 * A foto da câmera tem 3 a 8 MB; enviada pela rede móvel do CEASA, era a maior
 * parte dos 12–15 s para salvar uma nota. O servidor já reduz a imagem para no
 * máximo 1600 px, então reduzir antes (2000 px, JPEG 85%) não perde legibilidade
 * e envia uma fração do tamanho. Se o navegador não conseguir processar a foto,
 * o arquivo original é enviado como antes.
 */

export const CLIENT_IMAGE_MAX_SIDE = 2000;
export const CLIENT_IMAGE_QUALITY = 0.85;
/** Abaixo disso não vale a pena reprocessar. */
export const CLIENT_IMAGE_SKIP_BYTES = 600 * 1024;

/** Novo tamanho mantendo a proporção, sem ampliar imagens pequenas. */
export function fitWithin(width: number, height: number, maxSide = CLIENT_IMAGE_MAX_SIDE): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Cai para <img> abaixo (Safari antigo).
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Imagem não pôde ser lida"));
      element.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/** Reduz a foto para envio. Nunca falha: em qualquer problema devolve o arquivo original. */
export async function compressImageForUpload(file: File): Promise<File> {
  if (typeof document === "undefined" || !file.type.startsWith("image/") || file.size <= CLIENT_IMAGE_SKIP_BYTES) {
    return file;
  }
  let decoded: Decoded | null = null;
  try {
    decoded = await decode(file);
    const target = fitWithin(decoded.width, decoded.height);
    if (target.width === 0) return file;

    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(decoded.source, 0, 0, target.width, target.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", CLIENT_IMAGE_QUALITY));
    if (!blob || blob.size >= file.size) return file;

    const name = file.name.replace(/\.[^.]+$/, "") || "nota";
    return new File([blob], `${name}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  } finally {
    decoded?.release();
  }
}
