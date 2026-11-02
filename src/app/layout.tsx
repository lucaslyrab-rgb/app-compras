import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./styles.css";
import "@/modules/navigation/operational-shell.css";

export const metadata: Metadata = {
  title: "MultiShow FLV",
  description: "Compras e pedidos de FLV da rede MultiShow",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/brand/ICON.png", apple: "/brand/ICON.png" }
};

// Identidade visual: Inter (legível no celular, números tabulares). Servida pelo próprio
// sistema após o build (next/font), sem depender do Google Fonts em tempo de uso.
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#006b4f" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
