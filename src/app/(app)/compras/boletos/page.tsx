import { redirect } from "next/navigation";

// O calendário de boletos foi para o Financeiro (Contas a pagar), junto com as outras contas.
export default function Boletos() {
  redirect("/financeiro");
}
