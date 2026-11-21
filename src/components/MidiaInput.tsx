"use client";
import { useState } from "react";

/**
 * Escolher áudio ou figurinha para a biblioteca do WhatsApp.
 * Figurinha: qualquer foto vira figurinha do WhatsApp (quadrada 512×512, formato WebP, até 100 KB).
 */
export default function MidiaInput({ tipo }: { tipo: "audio" | "figurinha" }) {
  const [arq, setArq] = useState<{ url: string; nome: string; mime: string } | null>(null);
  const [erro, setErro] = useState("");

  async function figurinha(f: File) {
    const img = await createImageBitmap(f);
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const g = c.getContext("2d")!;
    const k = Math.min(512 / img.width, 512 / img.height);
    const w = img.width * k, h = img.height * k;
    g.drawImage(img, (512 - w) / 2, (512 - h) / 2, w, h);
    for (const q of [0.9, 0.75, 0.6, 0.45, 0.3]) {
      const b: Blob | null = await new Promise((ok) => c.toBlob(ok, "image/webp", q));
      if (!b || b.type !== "image/webp") throw new Error("Este navegador não cria figurinha. Use o Chrome.");
      if (b.size <= 100 * 1024) return { url: await lerDataUrl(b), nome: f.name.replace(/\.\w+$/, "") + ".webp", mime: "image/webp" };
    }
    throw new Error("A imagem ficou grande demais para figurinha. Tente uma imagem mais simples.");
  }
  const lerDataUrl = (b: Blob) => new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(b); });

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setErro(""); setArq(null);
    if (!f) return;
    try {
      if (tipo === "figurinha") setArq(await figurinha(f));
      else {
        if (f.size > 16 * 1024 * 1024) throw new Error("Áudio maior que 16 MB.");
        const mime = f.type || (/\.opus$|\.ogg$/i.test(f.name) ? "audio/ogg" : /\.mp3$/i.test(f.name) ? "audio/mpeg" : /\.m4a$/i.test(f.name) ? "audio/mp4" : "");
        if (!/^audio\/(ogg|mpeg|mp4|aac|amr|x-m4a)/.test(mime)) throw new Error("Formato não aceito pelo WhatsApp. Use .ogg, .opus, .mp3 ou .m4a.");
        setArq({ url: await lerDataUrl(f), nome: f.name, mime: mime === "audio/x-m4a" ? "audio/mp4" : mime.split(";")[0] });
      }
    } catch (x) { setErro(x instanceof Error ? x.message : "Não deu para ler o arquivo."); }
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <input type="file" accept={tipo === "audio" ? "audio/*,.opus,.ogg,.m4a,.mp3" : "image/*"} onChange={escolher} required={!arq} style={{ paddingTop: 10 }} />
      {erro && <span className="aviso erro" style={{ margin: 0 }}>{erro}</span>}
      {arq && (tipo === "audio" ? <audio controls src={arq.url} style={{ width: "100%" }} /> : <img src={arq.url} alt="" width={120} height={120} style={{ background: "repeating-conic-gradient(#eee 0 25%, #fff 0 50%) 0 0/16px 16px", borderRadius: 8 }} />)}
      <input type="hidden" name="arq" value={arq?.url ?? ""} />
      <input type="hidden" name="arqNome" value={arq?.nome ?? ""} />
      <input type="hidden" name="arqMime" value={arq?.mime ?? ""} />
    </div>
  );
}
