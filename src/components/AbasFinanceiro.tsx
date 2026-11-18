const ABAS: [string, string, string][] = [
  ["pagamentos", "Contas a pagar", "/financeiro"],
  ["fluxo", "Fluxo de caixa", "/financeiro/fluxo"],
  ["receber", "Recebimentos", "/financeiro/receber"],
  ["historico", "Histórico de pagamentos", "/financeiro/historico"],
  ["extrato", "Extrato do banco", "/financeiro/extrato"],
];
export default function AbasFinanceiro({ ativo }: { ativo: string }) {
  return <div className="abas">{ABAS.map(([k, n, h]) => <a key={k} href={h} className={k === ativo ? "ativo" : ""}>{n}</a>)}</div>;
}
