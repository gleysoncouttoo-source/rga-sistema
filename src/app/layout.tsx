import "./globals.css";
import type { Metadata, Viewport } from "next";
import BotaoInstalar from "@/components/BotaoInstalar";

export const metadata: Metadata = {
  title: "Sistema R.G.A",
  description: "Gestão da R.G.A — Indústria e Ferramentaria de Precisão",
  applicationName: "R.G.A",
  appleWebApp: { capable: true, title: "R.G.A", statusBarStyle: "black" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#181A1D", viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>
        {children}
        <BotaoInstalar />
      </body>
    </html>
  );
}
