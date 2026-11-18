import type { Funcionario } from "@prisma/client";
import { salvarFuncionario } from "@/app/(app)/funcionarios/acoes";

const d = (v: Date | null | undefined) => (v ? v.toISOString().slice(0, 10) : "");

export default function FormFuncionario({
  f, setores, verSalario,
}: { f?: Funcionario | null; setores: string[]; verSalario: boolean }) {
  return (
    <form action={salvarFuncionario} className="campos">
      {f && <input type="hidden" name="id" value={f.id} />}
      <h2 className="inteiro" style={{ margin: 0 }}>Dados pessoais</h2>
      <label className="inteiro">Nome completo *<input name="nome" defaultValue={f?.nome ?? ""} required /></label>
      <label>CPF<input name="cpf" defaultValue={f?.cpf ?? ""} inputMode="numeric" /></label>
      <label>RG<input name="rg" defaultValue={f?.rg ?? ""} /></label>
      <label>Nascimento<input name="nascimento" type="date" defaultValue={d(f?.nascimento)} /></label>
      <label>Telefone / WhatsApp<input name="telefone" defaultValue={f?.telefone ?? ""} /></label>
      <label>E-mail<input name="email" type="email" defaultValue={f?.email ?? ""} placeholder="recebe o comprovante de pagamento" /></label>
      <label>Chave Pix (para pagamento)<input name="chavePix" defaultValue={f?.chavePix ?? ""} /></label>
      <label className="inteiro">Endereço<input name="endereco" defaultValue={f?.endereco ?? ""} /></label>
      <label className="inteiro">Contato de emergência<input name="contatoEmergencia" defaultValue={f?.contatoEmergencia ?? ""} /></label>

      <h2 className="inteiro" style={{ margin: "8px 0 0" }}>Contrato</h2>
      <label>Matrícula<input name="matricula" defaultValue={f?.matricula ?? ""} /></label>
      <label>Cargo
        <select name="cargo" defaultValue={f?.cargo ?? "Funcionário"}>
          <option>Diretor</option><option>Gestor</option><option>Funcionário</option>
        </select>
      </label>
      <label>Setor
        <select name="setor" defaultValue={f?.setor ?? ""}>
          <option value="">—</option>
          {setores.map((s) => <option key={s}>{s}</option>)}
          <option>Administrativo</option><option>Montagem</option><option>Expedição</option>
        </select>
      </label>
      <label>Tipo de contrato
        <select name="tipoContrato" defaultValue={f?.tipoContrato ?? "CLT"}>
          <option>CLT</option><option>PJ</option><option>Temporário</option><option>Aprendiz</option><option>Informal</option>
        </select>
      </label>
      <label>Turno<input name="turno" defaultValue={f?.turno ?? ""} placeholder="Ex.: 7h às 17h" /></label>
      <label>Admissão<input name="admissao" type="date" defaultValue={d(f?.admissao)} /></label>
      <label>Desligamento<input name="desligamento" type="date" defaultValue={d(f?.desligamento)} /></label>
      {verSalario && (
        <>
          <label>Salário (R$/mês)<input name="salario" inputMode="decimal" defaultValue={f?.salario ?? ""} placeholder="Ex.: 2500" /></label>
          <label>Encargos e provisões (% sobre o salário)<input name="encargosPct" inputMode="decimal" defaultValue={f?.encargosPct ?? ""} placeholder="Ex.: 68 (vazio = padrão de Custos)" /></label>
          <label>Benefícios e outros (R$/mês)<input name="beneficios" inputMode="decimal" defaultValue={f?.beneficios ?? ""} placeholder="VT, VR, plano de saúde..." /></label>
        </>
      )}

      <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <input type="checkbox" name="ativo" defaultChecked={f?.ativo ?? true} /> Funcionário ativo
      </label>
      <label className="inteiro">Observações<textarea name="observacoes" rows={3} defaultValue={f?.observacoes ?? ""} /></label>
      <div className="inteiro acoes">
        <button className="btn">Salvar</button>
        <a className="btn sec" href="/funcionarios">Voltar</a>
      </div>
    </form>
  );
}
