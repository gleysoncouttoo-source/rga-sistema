"use client";

import { useEffect, useState } from "react";
import { acaoAvisoTeste, acaoGuardarAparelho, acaoTirarAparelho } from "@/lib/acoesNotificacoes";

type Estado = "carregando" | "sem-suporte" | "iphone-instalar" | "bloqueado" | "desligado" | "ligado";

function chaveParaBytes(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const b = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

function nomeAparelho() {
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua)) return "iPhone";
  if (/android/i.test(ua)) return "Celular Android";
  return "Computador";
}

/** Liga ou desliga os avisos (notificação push) neste aparelho. */
export default function AtivarAvisos({ chavePublica, aparelhos }: { chavePublica: string; aparelhos: number }) {
  const [estado, setEstado] = useState<Estado>("carregando");
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    (async () => {
      const ua = navigator.userAgent;
      const iphone = /iphone|ipad|ipod/i.test(ua);
      const instalado = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setEstado(iphone && !instalado ? "iphone-instalar" : "sem-suporte");
        return;
      }
      if (Notification.permission === "denied") return setEstado("bloqueado");
      const reg = await navigator.serviceWorker.register("/sw.js");
      const insc = await reg.pushManager.getSubscription();
      setEstado(insc && Notification.permission === "granted" ? "ligado" : "desligado");
    })().catch(() => setEstado("sem-suporte"));
  }, []);

  async function ligar() {
    setOcupado(true); setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setEstado(perm === "denied" ? "bloqueado" : "desligado"); return; }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const insc = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveParaBytes(chavePublica) }));
      const r = await acaoGuardarAparelho(JSON.parse(JSON.stringify(insc)), nomeAparelho());
      if (!r.ok) { setMsg({ tipo: "erro", texto: r.erro || "Não deu certo." }); return; }
      setEstado("ligado");
      await acaoAvisoTeste();
      setMsg({ tipo: "ok", texto: "Avisos ligados neste aparelho. Mandamos um aviso de teste." });
    } catch {
      setMsg({ tipo: "erro", texto: "Não foi possível ligar os avisos neste aparelho. Tente de novo." });
    } finally { setOcupado(false); }
  }

  async function desligar() {
    setOcupado(true); setMsg(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const insc = await reg?.pushManager.getSubscription();
      if (insc) { await acaoTirarAparelho(insc.endpoint); await insc.unsubscribe(); }
      setEstado("desligado");
      setMsg({ tipo: "ok", texto: "Avisos desligados neste aparelho." });
    } finally { setOcupado(false); }
  }

  async function testar() {
    setOcupado(true); setMsg(null);
    try {
      const r = await acaoAvisoTeste();
      setMsg(r.enviados ? { tipo: "ok", texto: "Aviso de teste enviado. Deve chegar em alguns segundos." } : { tipo: "erro", texto: "Nenhum aparelho recebeu. Desligue e ligue de novo." });
    } finally { setOcupado(false); }
  }

  return (
    <div className="avisos-aparelho">
      <div className="avisos-status">
        <span className={`selo ${estado === "ligado" ? "ok" : estado === "carregando" ? "" : "alerta"}`}>
          {estado === "ligado" ? "Ligado neste aparelho" : estado === "carregando" ? "Conferindo…" : "Desligado neste aparelho"}
        </span>
        {aparelhos > 0 && <span className="suave">{aparelhos} aparelho(s) seu(s) recebe(m) avisos</span>}
      </div>
      {estado === "desligado" && <button type="button" className="btn destaque" onClick={ligar} disabled={ocupado}>{ocupado ? "Ligando…" : "Ligar avisos neste aparelho"}</button>}
      {estado === "ligado" && (
        <p className="acoes" style={{ margin: 0 }}>
          <button type="button" className="btn sec peq" onClick={testar} disabled={ocupado}>Mandar aviso de teste</button>
          <button type="button" className="btn sec peq perigo-txt" onClick={desligar} disabled={ocupado}>Desligar neste aparelho</button>
        </p>
      )}
      {estado === "iphone-instalar" && (
        <div className="aviso alerta" style={{ margin: 0 }}>No iPhone, os avisos só funcionam com o app instalado: toque em <b>Compartilhar</b> → <b>Adicionar à Tela de Início</b>, abra o R.G.A pelo ícone e volte aqui em Minha conta.</div>
      )}
      {estado === "bloqueado" && (
        <div className="aviso alerta" style={{ margin: 0 }}>Os avisos estão bloqueados para este site. Abra as configurações do navegador (cadeado ao lado do endereço → Notificações → Permitir) e recarregue a página.</div>
      )}
      {estado === "sem-suporte" && <div className="aviso alerta" style={{ margin: 0 }}>Este navegador não recebe avisos. No celular, use o Chrome (Android) ou o app instalado (iPhone).</div>}
      {msg && <div className={`aviso ${msg.tipo}`} style={{ margin: 0 }}>{msg.texto}</div>}
    </div>
  );
}
