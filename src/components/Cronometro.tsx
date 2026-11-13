"use client";
import { useEffect, useState } from "react";

const fmt = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`;
};

/** Relógio que corre na tela: início − pausas. Parado quando pausado. */
export default function Cronometro({ inicio, segPausado, pausadoEm }: { inicio: string; segPausado: number; pausadoEm: string | null }) {
  const calc = () => Math.max(0, ((pausadoEm ? new Date(pausadoEm).getTime() : Date.now()) - new Date(inicio).getTime()) / 1000 - segPausado);
  const [s, setS] = useState(calc);
  useEffect(() => {
    setS(calc());
    if (pausadoEm) return;
    const t = setInterval(() => setS(calc()), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inicio, segPausado, pausadoEm]);
  return <span className={`cronometro ${pausadoEm ? "pausado" : ""}`}>{fmt(s)}</span>;
}
