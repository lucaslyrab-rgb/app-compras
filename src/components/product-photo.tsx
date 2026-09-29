import Image from "next/image";

export type ProductPhotoSize = "sm" | "md" | "lg" | "xl" | number;

export type ProductPhotoProps = {
  productId?: string;
  name?: string;
  productName?: string;
  photoKey?: string | null;
  photoUpdatedAt?: Date | string | null;
  imageUrl?: string | null;
  size?: ProductPhotoSize;
  width?: number;
  height?: number;
  className?: string;
  thumbnailClassName?: string;
  alt?: string;
  priority?: boolean;
};

function resolveDimensions(size?: ProductPhotoSize, width?: number, height?: number): { w: number; h: number } {
  if (width && height) return { w: width, h: height };
  if (typeof size === "number") return { w: size, h: size };
  switch (size) {
    case "sm":
      return { w: 32, h: 32 };
    case "md":
      return { w: 40, h: 40 };
    case "lg":
      return { w: 64, h: 64 };
    case "xl":
      return { w: 120, h: 120 };
    default:
      return { w: 40, h: 40 };
  }
}

export function ProductPhoto({
  productId,
  name,
  productName,
  photoKey,
  photoUpdatedAt,
  imageUrl,
  size = "md",
  width,
  height,
  className = "",
  thumbnailClassName,
  alt,
  priority = false,
}: ProductPhotoProps) {
  const displayName = name || productName || "Produto";
  const { w, h } = resolveDimensions(size, width, height);

  let src: string | null = null;

  if (productId && photoKey) {
    const v = photoUpdatedAt
      ? photoUpdatedAt instanceof Date
        ? photoUpdatedAt.getTime()
        : new Date(photoUpdatedAt).getTime()
      : undefined;
    src = `/api/products/${productId}/photo${v ? `?v=${v}` : ""}`;
  } else if (imageUrl) {
    src = imageUrl;
  }

  const content = src ? (
    <Image
      src={src}
      alt={alt || `Foto de ${displayName}`}
      width={w}
      height={h}
      unoptimized
      priority={priority}
      className={`product-photo-img ${className}`}
      style={{
        objectFit: "cover",
        width: `${w}px`,
        height: `${h}px`,
        aspectRatio: "1 / 1",
      }}
    />
  ) : (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      focusable="false"
      aria-hidden="true"
      className={`product-photo-placeholder ${className}`}
      style={{
        width: `${w}px`,
        height: `${h}px`,
        aspectRatio: "1 / 1",
      }}
    >
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8" cy="8" r="1.5" />
      <path d="m4 17 5-5 4 4 3-3 4 4" />
    </svg>
  );

  if (thumbnailClassName) {
    return (
      <span className={thumbnailClassName} aria-hidden="true">
        {content}
      </span>
    );
  }

  return content;
}
