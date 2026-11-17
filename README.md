# Sistema R.G.A — versão 1.0

Base do sistema da fábrica: login com perfis, cadastro de funcionários, apontamento de produção pelo celular com recordes, e custo de mão de obra por peça.

## Novidades da v1.0
- **Produtos** (menu Produtos): produtos, conjuntos (corpos) e peças com SKU e miniatura de foto (tirada no celular ou arquivo, reduzida para 320 px). Em cada produto: as peças que vão nele e o **processo de cada peça** até ficar pronta para a montagem (ex.: Espelho L.O: Estampa → Pintura → Lixa → Verniz). Adicionar, tirar e mudar a ordem dos processos; nova operação ou nova etapa direto na tela. O processo também alimenta a mão de obra do custo do produto.
- **Produção por lote**: botão *Iniciar novo processo* → escolhe o produto pela foto, a parte, o processo, o lote e o colaborador → **cronômetro** (pausar, retomar, finalizar informando peças boas e refugo) ou lançamento direto de tempo + quantidade. O 1º processo abre um lote e consome a matéria-prima da estrutura; cada processo seguinte só aceita o que saiu do anterior; o último dá entrada no estoque da peça. Cada lote mostra o caminho (feitas, esperando, quem fez e em quanto tempo). Excluir um lançamento desfaz o estoque. "Sem lote" = peças que já estavam prontas antes do sistema.
- **Celular** (`/apontar`): o mesmo fluxo com foto, confirmado pelo PIN; cronômetros do colaborador aparecem no topo para finalizar.
- **Matéria-prima**: chapas e metais com material, medidas, unidade (kg, chapa, barra), peso de 1 unidade, peso total, preço, valor em estoque e totais por material; entrada, saída, contagem, editar e excluir.
- **Estoque parcial**: por peça, quantas estão prontas, quantas estão paradas entre processos e quais processos ainda faltam; filtro por produto.
- **Custos**: custo médio de cada produto (com foto e SKU) na semana (7 dias) e no mês (30 dias), com a variação e quantos foram montados.
- **Colaboradores**: recordes ultrapassados no mês (nome, processo, peças/h antes e depois), peças e horas de cada um no mês.
- **Adicionar e excluir** em todas as abas (o que já tem histórico de venda, compra ou produção só sai das listas; o histórico fica).
- **Histórico de alterações** (menu Histórico): todo campo criado, alterado ou excluído, com o login (ou o colaborador pelo celular) e o horário; filtros por tela, login, período e busca. Botão *Histórico* em cada produto.
- **Abas do menu por login**: em *Minha conta* cada um escolhe as abas que quer ver; o diretor ajusta de qualquer login em *Usuários e perfis*. O perfil continua mandando no acesso.
- Processos iniciais carregados: testa, contra-testa, caixa, tampa, lingueta, trinco, tambor, cilindro, espelhos, maçanetas 900/902/905, montagem dos corpos e montagem final dos 48 produtos. **Conferir**: espelho P.T (estampa → polimento → banho de zinco) e maçanetas foram montados pelas operações da planilha de julho; peças pequenas (cadeiras, travas, chaves…) e maçaneta 904 ainda sem processo.

## O que já funciona
- **Login e perfis**: Diretor, Gestor e Colaborador, com permissões por módulo e ação editáveis em *Usuários e perfis*. Qualquer pessoa cria a conta em `/cadastro` (nome, e-mail, cargo, senha); ela só entra depois que um diretor libera, escolhendo o cargo e quais abas pode abrir (ou todas). Bloqueio após 5 senhas erradas. Registro de atividades.
- **Funcionários**: cadastro sem limite (dados pessoais, contrato, salário, PIN do celular).
- **Produção**: etapas e operações carregadas da planilha de julho; a meta de cada operação é o recorde (menor tempo por peça). Novos recordes ficam pendentes até um Diretor ou Gestor confirmar.
- **Apontar produção** (`/apontar`, feito para celular): o operador escolhe o nome e a operação, informa peças boas, refugo e minutos, e confirma com o PIN.
- **Custos**: custo da hora = salário × (1 + encargos) ÷ horas/mês; mão de obra por peça no recorde e real dos últimos 30 dias.

- **Vendas → Estoque → Produção → Compras** (v0.2): quando entra um pedido de venda (pela tela ou pelo site), o sistema:
  1. separa o produto pronto que tem em estoque;
  2. o que falta, desce na estrutura (corpo → peças → aço/zamac/insumos) e separa o que tiver de cada nível;
  3. o que ainda falta e é comprado vira **pedido de compra sugerido**, um por fornecedor, sinalizado no painel;
  4. escolhe o **melhor dia para comprar**: entre hoje e a data limite (entrega − dias de fabricação − prazo de entrega do fornecedor − folga), o dia cujo boleto (compra + prazo de pagamento, jogado para dia útil) cai no dia com menos boletos. Se já passou do limite, marca **urgente** e sugere um vencimento próximo mais vazio para negociar.
- **Estoque**: 107 itens já cadastrados da planilha "Tabela de Custos - Fechadura Mecânica" (48 fechaduras, 3 corpos, peças, aço, zamac e insumos), com disponível, reservado e a caminho.
- **Compras**: aprovar (boletos viram contas a pagar), material chegou (entra no estoque já separado para o pedido), trocar data ou fornecedor, calendário de boletos, cadastro de fornecedores com prazo de pagamento (ex.: 28/42/56) e de entrega.
- **Preços** (v0.3): histórico de todo preço pago (planilha, compra recebida, nota lançada à mão), preço pago hoje, recorde de menor preço e variação em 30/60/90 dias.
- **Recebimento pelo celular** (v0.3): em Compras → Receber material, informa data, nota fiscal, quantidade e preço que vieram; o estoque, o preço e o valor dos boletos se ajustam.
- **Histórico de compras** (v0.3): filtros por período, fornecedor, item e situação; total pago e % de entregas no prazo.
- **Prazo de entrega por compra** (v0.3): editável em cada pedido de compra (padrão = o do fornecedor).
- **Financeiro** (v0.4):
  - *Pagamentos do dia*: todas as contas por dia (compra aprovada entra sozinha com as parcelas; salários no 5º dia útil; contas fixas todo mês; contas avulsas ou parceladas pelo botão **Adicionar conta**). Forma de pagamento, linha digitável do boleto e chave Pix com botão de copiar. Marcar pago, baixar planilha.
  - *Fluxo de caixa* semanal (domingo a sábado) e mensal: saldo do Bradesco e do Santander, recebimentos, pagamentos, saldo previsto dia a dia, vencidos a receber e a pagar, baixar planilha e imprimir.
  - *Recebimentos*: contas a receber (clientes, Shopee, serviços), parceladas, ligadas ao pedido de venda.
- **Shopee** (v0.5): em *Vendas → Shopee*, envia a planilha exportada do Seller Center (Meus pedidos → Exportar, .xlsx ou .csv). Anúncio cujo SKU é igual ao código do produto liga sozinho; os outros são ligados uma vez (com "fechaduras por venda" para kits). Pedido *A enviar* entra no fluxo normal (estoque → produção → compras); *Enviado/Concluído* entra como venda entregue (baixa no estoque opcional); cancelado/devolução não conta. Reenviar a planilha só atualiza a situação. Guarda comprador, total pago e taxas.
- **Shopee automática** (v0.6): em *Vendas → Shopee → Conectar loja*, o vendedor autoriza na Shopee e o sistema guarda o acesso (renovado sozinho a cada 4 h). Pedidos entram por três caminhos: aviso instantâneo da Shopee (`POST /api/shopee/aviso`, assinatura conferida), conferência diária da Vercel (`/api/shopee/sincronizar`, `vercel.json`) e conferência sempre que alguém abre Vendas (mais de 10 min da última). Na 1ª conexão puxa os últimos 15 dias. Taxas vêm do extrato do pedido. Pedido com anúncio sem produto vai para "Automático — anúncios sem produto" para ligar e importar.
  - Para ativar: cadastro em open.shopee.com (conta de vendedor → criar app "Seller In-house System"), esperar aprovação, colocar `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY` e `CRON_SECRET` na Vercel, cadastrar no app da Shopee o endereço de retorno (domínio do sistema) e o aviso `https://SEU-ENDERECO/api/shopee/aviso` com "Order Status Update".
- **Encargos por colaborador** (v0.9): na ficha do colaborador, encargos e provisões (%) e benefícios (R$/mês). Custo da hora = (salário × (1 + encargos dele) + benefícios) ÷ horas/mês; sem encargos próprios usa o % padrão de Custos. Vale para o apontamento, Custos e Lucros.
- **Lucros** (v0.8, menu Lucros): lucro de cada produto em todos os canais (Shopee, site, direto) e por canal = vendido − taxas da Shopee − imposto − custo do produto − Anúncios Shopee (rateados pelos produtos de cada anúncio). O custo do produto é único no sistema (`lib/custoProduto.ts`): material da estrutura + mão de obra das operações ligadas a cada peça (mesmo valor da tela de Custos: real dos últimos 30 dias ou no recorde) + % de energia e despesas + extra por unidade. Ligação peça × operação editável na própria tela, com sugestão automática pelo nome (marcada "conferir"). Montagem ainda não tem operação com tempo.
- **Lucro por anúncio da Shopee** (v0.7): em *Vendas → Lucro por anúncio*, envia o relatório dos Anúncios Shopee (Marketing → Anúncios Shopee → Exportar dados). Por anúncio: vendas, taxas da Shopee (rateadas pelo valor do item), imposto, custo da fechadura (material da estrutura + % de MO/energia/despesas + extra por unidade, configuráveis), gasto com Ads, ROAS dos Ads, ROAS geral, **ROAS mínimo** (a partir do qual o Ads se paga) e quanto sobra (total e por fechadura). Período livre; gasto de Ads proporcional aos dias quando o período não bate com o do relatório.
- **Métricas e recordes de vendas** (v0.5): em *Vendas → Métricas e recordes*, faturamento, fechaduras, pedidos, ticket médio e taxas da Shopee por período (7/30/90 dias, mês, ano, 12 meses) e canal, comparando com o período anterior; faturamento por mês; produtos mais vendidos. Recordes de melhor dia, semana e mês (faturamento e unidades), por canal e melhor mês de cada produto: só períodos fechados, pendentes até diretor/gestor confirmar; mostra quanto falta para bater no período atual.
- **Pedidos do site**: `POST /api/pedidos` com `Authorization: Bearer SITE_API_TOKEN` e `{ "numero", "cliente", "entrega": "AAAA-MM-DD", "itens": [{ "codigo": "FM-EXT400LO900", "quantidade": 10, "preco": 44.24 }] }`.

Configurações (tabela Configuracao): `folgaCompraDias` (2), `maxBoletosDia` (2, a partir daí o dia aparece como cheio), `prazoEntregaPadrao` (10 dias, quando o pedido vem sem data).

## Colocar online (Vercel + Neon)
No ar desde 17/11/2026: https://rga-sistema.vercel.app (Vercel, banco Neon `rga-banco`). Cada envio para a branch `main` publica sozinho.

1. Importe o repositório do GitHub em vercel.com/new.
2. No projeto da Vercel, vá em **Storage → Create → Neon (Postgres)** e conecte ao projeto. Isso cria `DATABASE_URL` e `DATABASE_URL_UNPOOLED`.
3. Faça um novo deploy. O script `vercel-build` cria as tabelas, faz a carga inicial e compila.
4. Abra o endereço do site: na primeira vez aparece a tela **Primeiro acesso** para criar o login do diretor.

## Como rodar no computador (Node.js 20+ e um Postgres)
```bash
npm install
cp .env.example .env   # preencha DATABASE_URL e DATABASE_URL_UNPOOLED
npm run setup
npm run build && npm start   # http://localhost:3000
```

## Tecnologia
Next.js 15 + TypeScript, Prisma com PostgreSQL.

## Próximos módulos (plano)
Apontamento de produção dando entrada nas peças, compra pelo consumo semanal, folha de pagamento, fluxo de caixa, lembretes por WhatsApp.
