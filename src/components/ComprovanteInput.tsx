"use client";
import { useState } from "react";

/** Escolhe a foto ou o PDF do comprovante. Foto é reduzida (até 1800 px) para caber; PDF vai como está (até 4 MB). */
export default function ComprovanteInput({ opcional = false }: { opcional?: boolean }) {
  const [arq, setArq] = useState(""), [nome, setNome] = useState(""), [erro, setErro] = useState("");
  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setErro(""); setArq(""); setNome("");
    if (!f) return;
    if (f.type === "application/pdf") {
      if (f.size > 4 * 1024 * 1024) { setErro("PDF maior que 4 MB. Salve de novo em tamanho menor."); return; }
      const r = new FileReader();
      r.onload = () => { setArq(String(r.result)); setNome(f.name); };
      r.readAsDataURL(f);
      return;
    }
    if (!f.type.startsWith("image/")) { setErro("Use foto (JPG, PNG) ou PDF."); return; }
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1800 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      setArq(c.toDataURL("image/jpeg", 0.85)); setNome(f.name.replace(/\.\w+$/, "") + ".jpg");
      URL.revokeObjectURL(url);
    };
    img.onerror = () => setErro("Não consegui abrir essa imagem.");
    img.src = url;
  }
  return (
    <>
      <input type="file" accept="image/*,application/pdf" onChange={escolher} required={!opcional && !arq} />
      {erro && <span style={{ color: "var(--erro)", fontSize: ".82rem" }}>{erro}</span>}
      <input type="hidden" name="arq" value={arq} />
      <input type="hidden" name="arqNome" value={nome} />
    </>
  );
}
