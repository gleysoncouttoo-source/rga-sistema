// App R.G.A: guarda só arquivos fixos (ícones, estilos, scripts) para abrir rápido.
// As telas e os dados vêm sempre da internet; sem conexão aparece um aviso.
const CACHE = "rga-v1";
const OFFLINE = "/offline";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, "/app/icone-192.png", "/marca/logo-claro.png"])));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/app/") || url.pathname.startsWith("/marca/")) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copia = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copia));
            }
            return res;
          })
      )
    );
  }
});

// Avisos do sistema (notificação push): mostra o aviso e, ao tocar, abre a tela certa.
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { texto: e.data ? e.data.text() : "" }; }
  e.waitUntil(
    self.registration.showNotification(d.titulo || "Sistema R.G.A", {
      body: d.texto || "",
      icon: "/app/icone-192.png",
      badge: "/app/icone-192.png",
      tag: d.tag || undefined,
      data: { link: d.link || "/" },
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const alvo = new URL((e.notification.data && e.notification.data.link) || "/", self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((janelas) => {
      for (const j of janelas) {
        if (j.url.startsWith(self.location.origin) && "focus" in j) { j.navigate(alvo); return j.focus(); }
      }
      return self.clients.openWindow(alvo);
    })
  );
});
