"use client";
import { useState } from "react";

/** Escolhe uma foto (câmera ou arquivo), reduz para miniatura (320 px) e manda em um campo escondido. */
export default function FotoInput({ name = "foto", atual }: { name?: string; atual?: string | null }) {
  const [foto, setFoto] = useState<string>(atual ?? "");
  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      const max = 320, k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      setFoto(c.toDataURL("image/jpeg", 0.82));
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }
  return (
    <div className="foto-input">
      <div className="mini grande">{foto ? <img src={foto} alt="" /> : <span>sem foto</span>}</div>
      <div className="acoes">
        <label className="btn sec peq" style={{ flexDirection: "row", color: "var(--texto)" }}>
          {foto ? "Trocar foto" : "Adicionar foto"}
          <input type="file" accept="image/*" onChange={escolher} style={{ display: "none" }} />
        </label>
        {foto && <button type="button" className="btn sec peq" onClick={() => setFoto("")}>Tirar foto</button>}
      </div>
      <input type="hidden" name={name} value={foto} />
    </div>
  );
}
