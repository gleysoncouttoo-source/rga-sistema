const ABAS: [string, string, string][] = [
  ["pagamentos", "Pagamentos do dia", "/financeiro"],
  ["fluxo", "Fluxo de caixa", "/financeiro/fluxo"],
  ["receber", "Recebimentos", "/financeiro/receber"],
];
export default function AbasFinanceiro({ ativo }: { ativo: string }) {
  return <div className="abas">{ABAS.map(([k, n, h]) => <a key={k} href={h} className={k === ativo ? "ativo" : ""}>{n}</a>)}</div>;
}
