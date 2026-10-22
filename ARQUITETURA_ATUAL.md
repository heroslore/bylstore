# ARQUITETURA_ATUAL — HEROS CELL / BYL IMPORTADOS

Data do diagnóstico: 22/10/2026. Branch analisado: `claude/custo-aparelhos-j2goar`.

Este documento descreve **somente o que existe** no repositório `heroslore/bylstore`. Nada aqui foi inferido de desejos ou de planos; o que não foi encontrado está listado como ausente.

## 1. Visão geral

O repositório contém **dois programas independentes**, ambos páginas HTML únicas com JavaScript puro, sem framework, sem bundler e sem testes automatizados.

| | BYL STORE v3 | Gestão de Aparelhos |
|---|---|---|
| Caminho | `index.html` (raiz, 1.028 linhas) | `gestao-aparelhos/` (index.html com 2.813 linhas + funções Netlify) |
| Negócio | Varejo de Xiaomi/Samsung com orçamento, venda parcelada (crediário) e geração de arte para Instagram | Atacado de iPhones de leilão: custo de importação, estoque, vendas, clientes, calculadora de lances |
| Hospedagem | Netlify, site `bylrada` (inferido pela conta Netlify; o repositório não traz configuração de deploy) | Netlify, site `gestao-aparelhos` (deploy manual pela CLI do MCP) |
| Persistência | `localStorage` + **Supabase** (REST, chave anônima no código) | `localStorage` + **Netlify Blobs** (via função serverless, protegido por senha) |
| Autenticação | Nenhuma | Senha única de acesso (hash PBKDF2 em Blobs; `SYNC_KEY` como senha inicial) |
| Backend | Nenhum próprio (Supabase direto do navegador) | Netlify Functions v2 (`sync`, `ler-tabela`) |
| IA | Nenhuma | Leitura de print de tabela de leilão com Claude (`claude-opus-5`) via `@anthropic-ai/sdk` |

Linguagem: **JavaScript (ES2020+)** no navegador e **Node.js ESM** nas funções Netlify. Bibliotecas: `@netlify/blobs`, `@anthropic-ai/sdk`. Fonte Google (Instrument Sans) no app de gestão.

## 2. Estrutura de pastas

```
/
├─ index.html                       BYL STORE v3 (app completo em um arquivo)
├─ custo-aparelhos.html             (removido; movido para gestao-aparelhos/index.html)
└─ gestao-aparelhos/
   ├─ index.html                    app Gestão de Aparelhos (UI + lógica + cálculo)
   ├─ sw.js                         service worker (offline, network-first)
   ├─ manifest.webmanifest          PWA (instalável)
   ├─ icons/                        ícones PNG 192/512/maskable
   ├─ netlify.toml                  publish="." functions="netlify/functions" (esbuild)
   ├─ package.json                  @netlify/blobs, @anthropic-ai/sdk
   └─ netlify/
      ├─ lib/auth.mjs               senha: PBKDF2, blob "auth", fallback SYNC_KEY
      └─ functions/
         ├─ sync.mjs                GET/PUT /api/sync, POST /api/sync/senha
         └─ ler-tabela.mjs          POST /api/ler-tabela (imagem → TSV via Claude)
```

Não existem: pastas de testes, CI, linters, documentação além deste arquivo, variáveis de ambiente versionadas.

## 3. BYL STORE v3 (`index.html` na raiz)

### 3.1 Dados e banco

Supabase projeto `ouvxejdflebmsyzoohca`, acessado por REST com a **chave anônima embutida no HTML** (linha ~997). Tabelas usadas:

| Tabela | Colunas usadas | Uso |
|---|---|---|
| `produtos_custom` | cod, nome, short, usd | produtos cadastrados pelo usuário além da lista fixa `PRODS_BASE` |
| `estoque` | cod, nome, short, usd, qtd, custo_total, foto | quantidade e custo acumulado por código de produto (sem IMEI, sem unidade individual) |
| `orcamentos` | id, criado, produto (JSON), custo, venda, planos (JSON), status, venda_data, plano_esc, entrada, parcelas (JSON) | orçamento → venda; `parcelas` é uma lista `{num, venc, valor, prop, pago}` |

Cópia local em `localStorage` (`byl_cp`, `byl_est`, `byl_orc`, `byl_fotos`). `syncAll()` no carregamento baixa do Supabase e sobrescreve o local.

### 3.2 Funcionalidades

- Lista fixa de produtos (`PRODS_BASE`, Xiaomi/Samsung com preço USD) + produtos custom.
- Entrada de estoque com conversão USD→BRL e custo médio por código (`cm(cod)`).
- Orçamento com multiplicador de venda e **planos de parcelamento** (`PS`: 6, 8, 10… parcelas com acréscimo e entrada).
- Confirmação de venda: baixa 1 unidade do estoque, gera parcelas (`genParcs`) com vencimento mensal e primeira parcela proporcional.
- Histórico de vendas com marcação de parcela paga (`toggleParc`).
- Análise: faturamento, recebido, número de vendas e em qual parcela o custo é recuperado (ROI).
- Envio de orçamento por WhatsApp (`enviarWA`), geração de imagem para Instagram (canvas), fotos de produto em base64.

### 3.3 Problemas técnicos encontrados

1. **Chave do Supabase no código-fonte** e, muito provavelmente, tabelas sem RLS restritiva: qualquer pessoa com o HTML pode ler e escrever `estoque` e `orcamentos`. É o principal risco de segurança do repositório.
2. Sem autenticação: qualquer um que abra a URL opera a loja.
3. Erros de rede são apenas `console.error`; falha de upsert passa despercebida.
4. Estoque é agregado por código (qtd + custo total); **não há IMEI, bateria, estado, fornecedor, data de entrada por unidade**.
5. Não há despesas, garantias, fornecedores, contas a pagar, nem meta-dados de pagamento além de entrada/parcelas.
6. Fotos em base64 dentro do `localStorage` e da tabela `estoque` (crescimento sem limite).

## 4. Gestão de Aparelhos (`gestao-aparelhos/`)

### 4.1 Modelo de dados (um único documento JSON em Netlify Blobs, chave `state`)

```
settings  { taxaFixa, notaPct, frete1, frete2, cotacao, empresa, contato }
draft     compra em edição { editingId, nome, data, rows[{id, modelo, preco(US$ lance), notaPct|null, qty}] }
compras   [{ id, nome, data, settings(snapshot), rows[...], criadoEm }]
vendas    [{ id, data, clienteId, clienteNome, itens[{ compraId, rowId, modelo, custoUSD, custoBRL, qty, preco(R$), obs }], criadoEm }]
clientes  [{ id, nome, telefone, obs, criadoEm }]
precos    [{ id, modelo, preco }]            lista de preços de venda (base Shaar Cell embutida)
calc      { margem, base: "venda"|"custo", rows[...] }   análise de lances
filtro    período/cliente da aba Vendas
vendaDraft, ultimoBackup, updatedAt
```

Blob `auth` guarda `{salt, hash, iter}` da senha. Store Blobs: `gestao-aparelhos`, consistência forte.

### 4.2 Regras de negócio implementadas (funções determinísticas no front-end)

- **Custo em SP por unidade** (`calcRow`): `lance + taxaFixa + (lance × notaPct% × (frete1% + frete2%))`, convertido por `cotacao`. Os dois fretes incidem sobre o valor da nota; não há cumulatividade.
- **Estoque** (`stockList`): por linha de compra, `disponível = qty − vendidos` (vendidos somados das vendas que referenciam `compraId/rowId`). Custo unitário é recalculado a partir do snapshot de parâmetros da compra, ou seja, editar a compra recalcula o custo dos itens não vendidos **e** dos já vendidos (o lucro das vendas é calculado "ao vivo" por `itemCusto`).
- **Lucro de venda**: `preço − custoBRL` por item; margem sobre a venda. Filtro por período e cliente; quebra por dia/mês.
- **Calculadora**: margem alvo sobre a venda ou sobre o custo; lance máximo que atinge a meta; importação de tabela colada (TSV) e de print (IA); lista de preços com casamento por nome normalizado (Pro/Max/Plus/Mini obrigatórios).
- **Clientes**: criados automaticamente na venda; histórico por cliente.
- **Documentos**: PDF via `window.print` (compra, relação para cliente, estoque).

### 4.3 APIs existentes

| Rota | Método | Autenticação | Função |
|---|---|---|---|
| `/api/sync` | GET | header `x-sync-key` | devolve `{updatedAt, dados}` |
| `/api/sync` | PUT | header `x-sync-key` | grava estado; 409 com cópia da nuvem se `baseUpdatedAt` divergir (concorrência otimista) |
| `/api/sync/senha` | POST | corpo `{atual, nova}` | troca a senha (hash em Blobs) |
| `/api/ler-tabela` | POST | header `x-sync-key` | imagens base64 → TSV (Claude) |

Variáveis de ambiente em uso na Netlify: `SYNC_KEY`, `ANTHROPIC_API_KEY`.

### 4.4 Autenticação e permissões

Senha única, um perfil só (proprietário). Não há usuários, papéis nem trilha de auditoria. O front-end guarda a senha no `localStorage` e a envia em cada chamada.

### 4.5 Sincronização e concorrência

Push 1,2 s após cada alteração; pull ao abrir, ao voltar o foco e a cada 45 s. Conflito → a cópia mais nova vence e o app avisa. Qualquer escrita feita por um agente no blob `state` deve respeitar esse protocolo (ler `updatedAt`, gravar com `updatedAt` novo), senão o app sobrescreve ou é sobrescrito.

### 4.6 Problemas técnicos encontrados

1. Um único arquivo de 2.800 linhas concentra UI, estado e cálculo; as funções de cálculo não existem no servidor (teriam de ser duplicadas ou extraídas).
2. Nenhum teste automatizado versionado (os testes feitos durante o desenvolvimento ficaram fora do repositório).
3. Edição de compra altera retroativamente o custo de vendas já feitas (decisão de projeto, mas é um risco para relatórios financeiros).
4. Dados em um único documento JSON: adequado para um usuário, inadequado para muitas escritas concorrentes ou consultas complexas.
5. Deploy manual; sem CI.

## 5. Funcionalidades ausentes nos dois sistemas

Não existem registros, telas nem cálculos para: **fornecedores** (apenas o nome da compra), **IMEI/bateria/estado por unidade**, **despesas** operacionais, **garantias e manutenções**, **contas a pagar**, **tributos e tarifas de pagamento**, **comissões**, **metas**, **usuários e papéis**. O crediário existe **somente no BYL** (parcelas com flag `pago`), não no Gestão de Aparelhos.

## 6. Pontos de integração para a camada de agentes

| Ponto | Onde | Observação |
|---|---|---|
| Leitura do estado do Gestão de Aparelhos | Blob `state` | fonte oficial de estoque, compras, vendas, preços e parâmetros |
| Leitura do BYL | Supabase REST (`estoque`, `orcamentos`) | dá acesso real ao crediário e ao estoque Xiaomi/Samsung; somente leitura |
| Cálculo determinístico | portar `calcRow`, `stockList`, `vendaTotals`, `precoEntrada` para `netlify/lib` | os agentes chamam funções, não recalculam "de cabeça" |
| Chamada de IA | `netlify/lib` com `@anthropic-ai/sdk` | chave já configurada |
| Persistência de tarefas e memória | novos stores em Netlify Blobs | sem instalar banco novo |
| Interface | nova aba no `index.html` | mesmo padrão visual e mesmo protocolo de senha |
| Rotinas agendadas | Netlify Scheduled Functions (`config.schedule`) | disponíveis no plano atual |
| Execuções longas | respostas em streaming (SSE) nas funções | funções síncronas têm limite de ~26 s |

## 7. O que pode ser automatizado com os dados de hoje

- Análise de lances do leilão contra a lista de preços e contra o estoque (já parcialmente feito pela Calculadora).
- Detecção de aparelhos parados, giro por modelo, sugestão de reposição e liquidação (dados: compras, vendas).
- Precificação: preço mínimo e recomendado a partir de custo + margem + lista (sem tributos/tarifas, que não existem).
- Análise de vendas: faturamento, lucro, margem, ticket médio, por período e cliente.
- Financeiro parcial: receitas, custo das vendas, capital parado em estoque. **Não** há despesas nem contas a pagar.
- Crediário (BYL): parcelas vencidas, pendentes, recebido × faturado, ROI por venda.
- Auditoria: conferir cálculos entre agentes e contra as funções determinísticas; detectar inconsistências (estoque negativo, venda sem compra, preço zerado).
- Relatórios diários/semanais/mensais gravados em memória persistente.

## 8. Riscos e limitações

1. **Segurança do BYL**: integrar os agentes ao Supabase com a chave anônima atual mantém o risco existente; recomenda-se RLS e uma chave de serviço no servidor (fora deste escopo sem acesso ao painel do Supabase).
2. **Dados insuficientes** para 3 dos 12 agentes do pedido (Mercado, Garantias e parte do Financeiro/Crediário no Gestão de Aparelhos). Eles podem existir como agentes "indisponíveis" até que o modelo de dados seja estendido.
3. **Previsão de demanda** com poucas vendas registradas produzirá incerteza alta; o agente deve declarar isso.
4. **Custo de IA**: cada tarefa multiagente chama o modelo várias vezes (coordenador, especialista, auditor). Estimativa de US$ 0,05 a US$ 0,30 por tarefa com `claude-opus-5`.
5. **Limite de tempo** das funções Netlify: tarefas longas precisam de streaming ou de execução em etapas; não há fila externa nem workers.
6. **Concorrência** no blob `state`: escritas de agentes precisam passar pelo mesmo controle de `updatedAt` do app.
