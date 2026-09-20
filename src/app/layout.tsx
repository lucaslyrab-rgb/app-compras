import type { Metadata, Viewport } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "MultiShow FLV",
  description: "Compras e pedidos de FLV da rede MultiShow",
  manifest: "/manifest.webmanifest"
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#006b4f" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
