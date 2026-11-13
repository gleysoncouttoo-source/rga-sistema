"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { auditar, exigir } from "@/lib/auth";
import { pode } from "@/lib/permissoes";

const txt = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v === "" ? null : v;
};
const dt = (f: FormData, k: string) => {
  const v = txt(f, k);
  return v ? new Date(v + "T12:00:00") : null;
};
const valor = (f: FormData, k: string) => {
  const v = txt(f, k);
  if (!v) return null;
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

export async function salvarFuncionario(form: FormData) {
  const id = Number(form.get("id")) || null;
  const u = await exigir("funcionarios", id ? "editar" : "criar");
  const nome = txt(form, "nome");
  const cargo = txt(form, "cargo") ?? "Funcionário";
  const volta = id ? `/funcionarios/${id}` : "/funcionarios/novo";
  if (!nome) redirect(`${volta}?erro=` + encodeURIComponent("Informe o nome."));

  const pin = txt(form, "pin");
  if (pin && !/^\d{4,6}$/.test(pin)) redirect(`${volta}?erro=` + encodeURIComponent("O PIN precisa ter de 4 a 6 números."));

  const dados = {
    nome: nome!,
    matricula: txt(form, "matricula"),
    cpf: txt(form, "cpf")?.replace(/\D/g, "") || null,
    rg: txt(form, "rg"),
    nascimento: dt(form, "nascimento"),
    telefone: txt(form, "telefone"),
    chavePix: txt(form, "chavePix"),
    endereco: txt(form, "endereco"),
    contatoEmergencia: txt(form, "contatoEmergencia"),
    cargo,
    setor: txt(form, "setor"),
    tipoContrato: txt(form, "tipoContrato") ?? "CLT",
    turno: txt(form, "turno"),
    admissao: dt(form, "admissao"),
    desligamento: dt(form, "desligamento"),
    observacoes: txt(form, "observacoes"),
    ativo: form.get("ativo") === "on",
    ...(pode(u.permissoes, "funcionarios", "ver_salario") ? { salario: valor(form, "salario"), encargosPct: valor(form, "encargosPct"), beneficios: valor(form, "beneficios") } : {}),
    ...(pin ? { pinHash: await bcrypt.hash(pin, 10) } : {}),
  };

  try {
    if (id) {
      await db.funcionario.update({ where: { id }, data: dados });
      await auditar(u.nome, "editou funcionário", nome!);
    } else {
      const f = await db.funcionario.create({ data: dados });
      await auditar(u.nome, "cadastrou funcionário", nome!);
      revalidatePath("/funcionarios");
      redirect(`/funcionarios/${f.id}?ok=1`);
    }
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === "P2002") {
      redirect(`${volta}?erro=` + encodeURIComponent("Já existe um funcionário com esse CPF ou matrícula."));
    }
    throw e;
  }
  revalidatePath("/funcionarios");
  redirect(`/funcionarios/${id}?ok=1`);
}

/** Exclui o colaborador. Quem já tem produção, contas ou login fica como desligado (o histórico continua). */
export async function excluirFuncionario(form: FormData) {
  const u = await exigir("funcionarios", "excluir");
  const id = Number(form.get("id"));
  const f = await db.funcionario.findUniqueOrThrow({ where: { id }, include: { _count: { select: { apontamentos: true, contas: true, processos: true, recordes: true } }, usuario: true } });
  const c = f._count;
  if (c.apontamentos + c.contas + c.processos + c.recordes === 0 && !f.usuario) {
    await db.funcionario.delete({ where: { id } });
    await auditar(u.nome, "excluiu colaborador", f.nome);
    revalidatePath("/funcionarios");
    redirect("/funcionarios?ok=" + encodeURIComponent(`${f.nome} excluído.`));
  }
  await db.funcionario.update({ where: { id }, data: { ativo: false, desligamento: f.desligamento ?? new Date() } });
  await auditar(u.nome, "desligou colaborador", f.nome);
  revalidatePath("/funcionarios");
  redirect("/funcionarios?ok=" + encodeURIComponent(`${f.nome} tem produção ou contas lançadas, então foi marcado como desligado (o histórico continua).`));
}
