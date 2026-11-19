"use client";

import { useEffect, useState } from "react";

type EventoInstalar = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

// Barra fixa no rodapé com o botão "Instalar app". Some quando o app já está instalado.
export default function BotaoInstalar() {
  const [evento, setEvento] = useState<EventoInstalar | null>(null);
  const [sistema, setSistema] = useState<"android" | "iphone" | "outro">("outro");
  const [instalado, setInstalado] = useState(true);
  const [fechado, setFechado] = useState(false);
  const [ajuda, setAjuda] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

    const ua = navigator.userAgent;
    setSistema(/android/i.test(ua) ? "android" : /iphone|ipad|ipod/i.test(ua) ? "iphone" : "outro");
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    setInstalado(standalone);
    try {
      setFechado(sessionStorage.getItem("rga-instalar-fechado") === "1");
    } catch {}

    const pegar = (e: Event) => {
      e.preventDefault();
      setEvento(e as EventoInstalar);
    };
    const pronto = () => {
      setInstalado(true);
      setEvento(null);
    };
    window.addEventListener("beforeinstallprompt", pegar);
    window.addEventListener("appinstalled", pronto);
    return () => {
      window.removeEventListener("beforeinstallprompt", pegar);
      window.removeEventListener("appinstalled", pronto);
    };
  }, []);

  const mostrar = !instalado && !fechado && (evento !== null || sistema !== "outro");

  useEffect(() => {
    document.body.classList.toggle("com-instalar", mostrar);
  }, [mostrar]);

  if (!mostrar) return null;

  async function instalar() {
    if (evento) {
      await evento.prompt();
      const { outcome } = await evento.userChoice;
      setEvento(null);
      if (outcome === "accepted") setInstalado(true);
      return;
    }
    setAjuda(true);
  }

  function fechar() {
    setFechado(true);
    try {
      sessionStorage.setItem("rga-instalar-fechado", "1");
    } catch {}
  }

  return (
    <div className="instalar" role="region" aria-label="Instalar app">
      {ajuda && (
        <div className="instalar-ajuda">
          {sistema === "iphone" ? (
            <>
              No Safari, toque em <b>Compartilhar</b> (quadrado com seta para cima) e depois em <b>Adicionar à Tela de Início</b>.
            </>
          ) : (
            <>
              No Chrome, toque nos <b>três pontinhos ⋮</b> no alto da tela e depois em <b>Instalar app</b> (ou <b>Adicionar à tela inicial</b>).
            </>
          )}
          <button type="button" className="instalar-ok" onClick={() => setAjuda(false)}>
            Entendi
          </button>
        </div>
      )}
      <div className="instalar-barra">
        <img src="/app/icone-192.png" alt="" />
        <div className="instalar-txt">
          <b>App R.G.A</b>
          <span>Instale no celular e abra direto pela tela inicial</span>
        </div>
        <button type="button" className="btn instalar-btn" onClick={instalar}>
          Instalar app
        </button>
        <button type="button" className="instalar-x" onClick={fechar} aria-label="Agora não">
          ×
        </button>
      </div>
    </div>
  );
}
