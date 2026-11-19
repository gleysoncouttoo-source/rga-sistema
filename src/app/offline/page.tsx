export const dynamic = "force-static";

export default function SemInternet() {
  return (
    <div className="sem-internet">
      <img src="/marca/logo-claro.png" alt="R.G.A" />
      <h1>Sem internet</h1>
      <p>O app precisa de conexão para mostrar os dados. Confira o Wi-Fi ou os dados móveis e tente de novo.</p>
      <a className="btn" href="/">Tentar de novo</a>
    </div>
  );
}
