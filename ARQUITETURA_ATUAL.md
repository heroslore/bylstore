# ARQUITETURA ATUAL — BYL STORE v3 (Gestão)

Diagnóstico da Etapa 1 do projeto "Sistema multiagente de gestão Heros Cell / BYL Importados".
Data: 22/10/2026. Repositório analisado: `heroslore/bylstore` (branch `main`, commit `10f1266`).
Tudo abaixo foi lido no código ou conferido no banco. Nada foi alterado no programa nem no banco.

> **Pergunta em aberto:** este é o único programa de gestão encontrado. Nos repositórios do GitHub do
> Ygor não há outro sistema com IMEI, fornecedores, garantias ou despesas, e a pasta `D:\Heros Cell`
> do PC é de marketing. Se existir outra versão (por exemplo numa pasta do PC), este documento precisa
> ser refeito para ela.

---

## 1. Estrutura real do programa

| Item | O que existe |
|---|---|
| Arquivos | **1 arquivo**: `index.html` (1.028 linhas, 57 KB), com HTML, CSS e JavaScript juntos |
| Histórico | 12 commits, todos de 09/05/2026, feitos pelo editor web do GitHub ("Update index.html") |
| Build / dependências | Nenhum. Sem `package.json`, sem framework, sem bibliotecas. Só Google Fonts |
| Hospedagem | Página estática (tem metatags de app para iPhone: `apple-mobile-web-app-capable`) |
| Testes | Nenhum |
| Documentação | Nenhuma (nem README) |

Divisão do `index.html`:

- linhas 1–177: CSS (tema roxo e dourado)
- linhas 178–347: telas (4 abas e 3 janelas modais)
- linhas 348–1028: JavaScript (dados, cálculos, telas, Supabase)

## 2. Tecnologias identificadas

- **Linguagem:** JavaScript puro no navegador (sem módulos, funções globais, `onclick` no HTML).
- **Interface:** HTML gerado por template string e `innerHTML`.
- **Armazenamento local:** `localStorage` (chaves `byl_cp`, `byl_est`, `byl_orc`, `byl_fotos`).
- **Banco na nuvem:** Supabase, acessado direto do navegador pela API REST (`/rest/v1/`), com a chave
  pública (`anon`) escrita no código (`index.html:996-997`).
- **Integrações:** compartilhar texto (WhatsApp via `navigator.share` ou área de transferência) e gerar
  arte 1080×1080 para Instagram em `<canvas>`.

## 3. Banco de dados

Projeto Supabase `ouvxejdflebmsyzoohca`. Três tabelas usadas pelo código. Contagem lida em 22/10/2026
(só leitura, sem baixar dados de clientes):

| Tabela | Colunas usadas pelo código | Linhas hoje |
|---|---|---|
| `estoque` | `cod` (chave), `nome`, `short`, `usd`, `qtd`, `custo_total`, `foto` (imagem em base64) | 9 |
| `orcamentos` | `id`, `criado`, `produto` (json), `custo`, `venda`, `planos` (json), `status`, `venda_data`, `plano_esc`, `entrada`, `parcelas` (json), `created_at` | 0 |
| `produtos_custom` | `cod`, `nome`, `short`, `usd` | 0 |

Relacionamentos: **não há chaves estrangeiras**. O orçamento guarda uma cópia do produto em json.
Parcelas ficam dentro do orçamento, como lista json. Não existe tabela de clientes, vendas,
movimentações de estoque, fornecedores, garantias ou despesas.

O esquema SQL não está no repositório. As colunas acima foram deduzidas das chamadas do código.
A tabela `estoque` responde à chave pública sem login (conferido), ou seja, a segurança por linha (RLS)
está liberada para leitura anônima. Escrita e exclusão anônimas não foram testadas para não mexer
nos dados, mas o próprio programa grava e apaga com essa mesma chave, então estão liberadas também.

## 4. Funcionalidades existentes

### Aba Orçamento
- Lista de produtos: 9 fixos no código (Xiaomi POCO/Redmi e Samsung Galaxy A, preço em dólar) +
  produtos cadastrados pelo usuário.
- **Preço base = custo médio × multiplicador** (controle deslizante, padrão 2,5×).
- 3 planos de boleto: 6× (sem acréscimo, entrada 20%), 8× (+10%, entrada 25%, "melhor opção"),
  12× (+20%, entrada 30%). Entrada e parcela editáveis, um recalcula o outro.
- Salvar orçamento, enviar texto pelo WhatsApp, gerar arte do Instagram com os 3 planos.

### Aba Estoque
- Por produto: quantidade, custo médio, foto (reduzida para 300 px).
- **Dar entrada:** quantidade × preço em dólar × cotação → soma no custo total (custo médio ponderado).
- Botão "−" tira 1 unidade (sem motivo e sem registro).
- Cadastrar produto novo (código, nome, nome curto, preço US$).
- Restaurar estoque inicial e zerar estoque.

### Aba Histórico
- Orçamentos salvos, "Marcar como vendido" (escolhe plano, data e dia do vencimento).
- Ao vender: gera as parcelas (a 1ª proporcional aos dias até o vencimento) e baixa 1 unidade do estoque.
- Marcar parcela como paga / não paga. Apagar orçamento.

### Aba Análise
- Total vendido, total recebido (entrada + parcelas pagas) e número de vendas.
- Por venda: em qual parcela o recebido cobre o custo do aparelho ("ROI") e o acumulado mês a mês.

### Sincronização
- Ao abrir e no botão de sincronizar: baixa produtos, estoque e orçamentos do Supabase.

## 5. Processos de compra e venda (como o código faz hoje)

**Compra / entrada:** `custo unitário = preço US$ × cotação` (`index.html:533-552`). Não entram frete,
impostos, taxa de câmbio do cartão nem outras despesas. Não registra fornecedor, data ou nota.

**Venda (crediário próprio no boleto):** orçamento → "vendido" → parcelas geradas → baixa de 1 unidade
(`index.html:681-693`). A venda não registra **nome do cliente**, CPF, telefone, IMEI do aparelho
nem forma de pagamento diferente de boleto.

**Recebimento:** clique manual em "Pagar" na parcela. Sem data do pagamento, sem juros ou multa por atraso.

## 6. Cálculos financeiros (conferidos)

| Cálculo | Fórmula no código | Observação |
|---|---|---|
| Custo médio | `custo_total ÷ qtd` | correto (média ponderada) |
| Preço base | `custo médio × multiplicador` | é markup, não margem |
| "Margem" exibida | `(venda − custo) ÷ custo` (`index.html:472`) | **é markup com o nome de margem.** Com 2,5× mostra 150%; a margem real seria 60% |
| Total do plano | `preço base × acréscimo` (1,00 / 1,10 / 1,20) | ok |
| Parcela | `(total − entrada) ÷ nº de parcelas` | ok |
| 1ª parcela | `parcela × dias até o vencimento ÷ 30` (`index.html:676`) | **muda o total do contrato**: o cliente paga mais ou menos que o "Total do plano" mostrado |
| Lucro bruto do plano | `total do plano − custo médio` | não desconta taxa de boleto, inadimplência nem frete |
| Recebido | `entrada + parcelas marcadas como pagas` | separa faturamento de recebimento (bom) |

## 7. Autenticação e permissões

**Não existem.** Quem abre o endereço da página vê e altera tudo. A chave do Supabase está no código
público do GitHub, então qualquer pessoa pode ler, gravar e apagar as tabelas mesmo sem abrir a página.

## 8. Problemas técnicos encontrados

Em ordem de gravidade:

1. **Banco aberto para qualquer pessoa** (chave pública no repositório público + RLS liberada). Risco de
   apagarem ou alterarem estoque e contratos. Também vale para os dados de clientes, se forem incluídos.
2. **Orçamento salvo some ao recarregar.** `salvarOrc` grava só no aparelho (`index.html:501`), e ao abrir
   o programa `syncAll` troca a lista pela do Supabase; se o Supabase estiver vazio, a lista fica vazia
   (`index.html:1016-1017`), e o próximo orçamento salvo sobrescreve os antigos no aparelho. Isso
   explica a tabela `orcamentos` com 0 linhas.
3. **Gravação em dois lugares sem regra clara:** vender e marcar parcela grava só no Supabase; salvar
   orçamento, restaurar e zerar estoque gravam só no aparelho (`index.html:605-613`). Os dois ficam diferentes.
4. **1ª parcela proporcional altera o valor do contrato** (item da tabela acima).
5. **"Margem" é markup** (item da tabela acima). As regras do projeto pedem para não confundir os dois.
6. **Falhas de gravação são silenciosas:** erro do Supabase só vai para o console; sem internet,
   a venda parece salva mas não é.
7. **Sem histórico de estoque:** o "−" e a venda tiram unidades sem registrar quem, quando e por quê.
8. **Risco de código malicioso na tela:** nomes de produto vindos do banco entram direto em `innerHTML`
   (`index.html:582`). Como o banco é aberto, alguém pode injetar script.
9. **Data em UTC:** `td()` usa `toISOString` (`index.html:380`); depois das 21h em Brasília a data sai como o dia seguinte.
10. Detalhes: arte do Instagram escreve "6RAM" fixo para todo aparelho (`index.html:900`); cotação padrão 5,75
    na entrada e 5,37 no "restaurar"; fotos em base64 dentro da tabela de estoque.

## 9. Funcionalidades pedidas que **não existem** hoje

Comparação com o prompt mestre. Para os agentes trabalharem com dados reais, estes cadastros precisam ser criados:

| Pedido | Situação |
|---|---|
| Aparelho individual com IMEI, bateria, estado, cor, data de entrada | não existe (estoque é por modelo, só quantidade) |
| iPhones / seminovos | não há nenhum no catálogo (só Xiaomi e Samsung novos) |
| Fornecedores | não existe |
| Clientes | não existe (venda sem nome do cliente) |
| Vendas à vista / cartão / Pix | não existe (só boleto parcelado) |
| Garantias e manutenção | não existe |
| Despesas, contas a pagar, fluxo de caixa | não existe |
| Usuários, login, permissões, auditoria | não existe |
| Preço anunciado, status comercial, tempo em estoque | não existe |
| Backend / servidor | não existe (só página estática + Supabase) |

## 10. Pontos de integração dos agentes

1. **Supabase como fonte oficial.** Os agentes leem as tabelas por um serviço no servidor, com chave
   própria (nunca no navegador) e permissões só de leitura no início.
2. **Eventos do programa** que podem disparar automações: entrada de estoque (`confirmarEnt`), produto novo
   (`salvarNP`), orçamento salvo (`salvarOrc`), venda (`confirmarVenda`), parcela paga (`toggleParc`).
3. **Funções de cálculo** (`cm`, `calcPl`, `genParcs`) devem virar um módulo único, testado, usado pela
   página e pelos agentes, para os números baterem.
4. **Padrão que o Ygor já usa** no repositório `byl-whatsapp`: funções serverless na Vercel + Supabase +
   API da Anthropic com chave em variável de ambiente + cron diário. É o caminho natural para o
   coordenador, a fila de tarefas e as rotinas agendadas, sem trazer tecnologia nova.

## 11. O que pode ser automatizado já com os dados atuais

- Parcelas vencidas e a vencer (diário), com total em atraso.
- Produtos com estoque zero ou baixo.
- Recebido × vendido × custo por venda; parcela em que cada venda se paga.
- Simulação de preço por plano com margem real e markup lado a lado.
- Conferência de consistência: estoque negativo, venda sem baixa, orçamento do aparelho diferente do Supabase.

O que **não** dá para fazer de forma confiável com os dados atuais: previsão de demanda, giro e
sazonalidade (há 0 vendas registradas), análise de fornecedores e garantias (não há cadastro),
pesquisa de mercado de iPhones (não há iPhones no sistema).

## 12. Riscos e limitações

- **Volume de dados muito pequeno:** 9 produtos e 0 vendas no banco. Qualquer previsão agora seria inventada.
- **Banco aberto:** antes de pôr dados de clientes ou ligar agentes, é preciso fechar a segurança
  (login + RLS). Isso muda como a página acessa o banco, então precisa da aprovação do Ygor.
- **Programa em um arquivo só:** cada mudança mexe no mesmo arquivo; vale separar o JS em módulos aos poucos,
  sem reescrever as telas.
- **Chave da IA:** precisa ficar no servidor (Vercel), nunca na página.
- **Dúvida de escopo:** a BYL STORE vende Android novos no boleto; a Heros Cell vende iPhones no atacado.
  Não está claro se o mesmo programa deve atender as duas operações.
