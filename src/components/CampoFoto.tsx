"use client";
import { useState } from "react";
import SelectFoto, { type OpcaoFoto } from "./SelectFoto";

/** Lista suspensa com foto dentro de um formulário: manda o valor escolhido no campo `name`. */
export default function CampoFoto({ name, opcoes, placeholder, inicial = "", busca = true }: {
  name: string; opcoes: OpcaoFoto[]; placeholder?: string; inicial?: string; busca?: boolean;
}) {
  const [v, setV] = useState(inicial);
  return (
    <>
      <input type="hidden" name={name} value={v} />
      <SelectFoto opcoes={opcoes} valor={v} onChange={setV} placeholder={placeholder} busca={busca} />
    </>
  );
}
