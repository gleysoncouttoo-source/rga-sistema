"use client";
import { useFormStatus } from "react-dom";

/** Botão de formulário que mostra que está trabalhando (busca que pode levar alguns segundos). */
export default function BotaoEnviando({ children, enviando, className = "btn" }: { children: React.ReactNode; enviando: string; className?: string }) {
  const { pending } = useFormStatus();
  return <button className={className} disabled={pending} aria-busy={pending}>{pending ? enviando : children}</button>;
}
