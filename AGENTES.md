# Agentes da BYL STORE / Heros Cell

Camada multiagente que roda **no PC** (modelo misto): agentes, fila, memória, auditoria e relatórios ficam no PC;
os dados do programa (estoque, orçamentos, vendas) continuam no Supabase, que o `index.html` usa.
Os agentes **só leem** o banco. Qualquer gravação vira pedido de aprovação na Central.

## Como rodar no PC (Windows)

1. Instale o **Node.js 22 LTS** (https://nodejs.org).
2. Baixe esta pasta do GitHub (botão Code → Download ZIP, ou `git clone`).
3. Dê dois cliques em **`INICIAR-CENTRAL.bat`**. Na primeira vez ele cria o `agentes.env` e abre no Bloco de Notas:
   preencha `SUPABASE_KEY`, `SUPABASE_SENHA` (do usuário dos agentes) e `ADMIN_SENHA` (senha da Central).
4. A Central abre em http://127.0.0.1:8787 .

Rotinas automáticas: rodam sozinhas enquanto a Central estiver aberta. Para rodar mesmo com ela fechada,
crie uma tarefa no Agendador de Tarefas do Windows que execute, todo dia às 08:00, na pasta do programa:
`node --env-file-if-exists=agentes.env agentes\cli.js --rotinas`

Pela linha de comando: `npm run pedido -- "quais parcelas estão atrasadas?"`

## Segurança do banco (fazer uma vez, nesta ordem)

1. Supabase → Authentication → Users → **Add user**: o seu e-mail (marque *Auto Confirm User*) e `agentes@byl.local`.
2. Supabase → Authentication → Sign In / Providers: **desligue "Allow new users to sign up"**.
3. Faça o merge deste PR: a Vercel publica o `index.html` novo (com tela de login) sozinha.
4. Logo em seguida, no SQL Editor, rode `supabase/migracoes/000_fechar_acesso_publico.sql` trocando `TROQUE-PELO-SEU-EMAIL@exemplo.com` pelo seu e-mail.
   Emergência: `000_desfazer.sql` volta ao acesso aberto.

Depois disso a chave pública do código não abre mais nada: só entra quem está na tabela `app_usuarios`
(`admin` lê e grava; `leitura` só lê, que é o caso dos agentes).

## Estrutura

| Arquivo | O que faz |
|---|---|
| `core/calculos.js` | Cálculos determinísticos (markup, margem, preço mínimo, parcelas, lucro esperado × realizado) |
| `agentes/nucleo/fila.js` | Fila de tarefas: 7 estados, tentativas, dependências, idempotência, recuperação após interrupção |
| `agentes/nucleo/permissoes.js` | Níveis 1/2/3 e aprovações (só proprietário autenticado; nível 3 exige código) |
| `agentes/nucleo/ferramentas.js` | Ferramentas com contrato de entrada/saída, nível e agentes autorizados |
| `agentes/nucleo/auditoria.js` | Trilha de auditoria encadeada por hash |
| `agentes/nucleo/memoria.js` | Memória persistente indexada (palavra-chave, assunto, agente, data, tarefa, aparelho, operação) |
| `agentes/nucleo/llm.js` | Interpretação do pedido com IA (opcional, chave no `agentes.env`) |
| `agentes/coordenador.js` | Agente 00 |
| `agentes/especialistas.js` | Agentes 01 a 10 |
| `agentes/auditor.js` | Agente 11 |
| `agentes/rotinas.js` | Rotinas diária, semanal e mensal |
| `agentes/servidor.js` + `central.html` | Central de Inteligência local |
| `testes/` | `npm test` (16 testes, sem tocar no banco real) |

## O que cada agente consegue fazer hoje

| Agente | Situação com os dados atuais |
|---|---|
| 03 Estoque | Funciona: unidades, capital em estoque, zerados, baixos, inconsistências, duplicados |
| 04 Precificação | Funciona: preço base, markup, margem, preço mínimo, desconto máximo, planos 6/8/12× |
| 05 Vendas, 06 Financeiro, 07 Crediário | Funcionam quando houver vendas registradas (hoje o banco tem 0) |
| 10 Inteligência | Cruza estoque × vendas; fraco sem vendas |
| 01 Compras, 09 Demanda | Respondem "dados insuficientes" até haver histórico de vendas |
| 02 Mercado | Precisa de fontes de preço autorizadas por você |
| 08 Garantias | Precisa do cadastro de garantias e de aparelho com IMEI (ainda não existe no programa) |
