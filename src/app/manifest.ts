import type { MetadataRoute } from "next";

// Faz o sistema virar app instalável no celular (ícone na tela inicial, abre em tela cheia).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Sistema R.G.A",
    short_name: "R.G.A",
    description: "Gestão da R.G.A — Indústria e Ferramentaria de Precisão",
    lang: "pt-BR",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#181A1D",
    theme_color: "#181A1D",
    icons: [
      { src: "/app/icone-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app/icone-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app/icone-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Apontar produção", short_name: "Apontar", url: "/apontar", icons: [{ src: "/app/icone-192.png", sizes: "192x192" }] },
    ],
  };
}
