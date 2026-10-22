# PLANO_IMPLEMENTACAO — Camada multiagente HEROS CELL

Baseado em `ARQUITETURA_ATUAL.md`. Regra: **nada do que existe é recriado**. A camada de agentes vive em `gestao-aparelhos/netlify/` e numa aba nova do app; lê o BYL pelo Supabase somente para leitura.

## Decisões de arquitetura

| Tema | Decisão | Motivo |
|---|---|---|
| Onde roda a IA | Netlify Functions (Node ESM) com `@anthropic-ai/sdk` | já existe chave, senha e padrão de função |
| Modelo | `claude-opus-5` em coordenador, especialistas e auditor; constante por agente em `agentes.mjs` para trocar | qualidade de raciocínio; custo pode ser reduzido trocando especialistas para `claude-sonnet-5` |
| Fila de tarefas | Netlify Blobs, store `agentes`, chave `tarefa/<id>` + índice | persistente, sem banco novo |
| Memória | Netlify Blobs, store `memoria`, documentos com `palavras`, `agente`, `data`, `tarefa`, `aparelho`, `tipo` + índice invertido por palavra | busca por palavra-chave sem dependência externa; semântica fica para depois |
| Ferramentas | registro em `ferramentas.mjs` com contrato de entrada/saída (JSON Schema), **nível** (1 autônomo, 2 aprovação, 3 crítico) e handler determinístico | o modelo só chama; quem calcula é código |
| Dados oficiais | blob `state` (Gestão) e Supabase REST (BYL, leitura) | o banco continua a fonte; a memória guarda análises e decisões, não transações |
| Execução longa | resposta em streaming (SSE) da função `/api/agentes/comando` | contorna o limite de funções síncronas |
| Aprovação | tarefa fica `AGUARDANDO_APROVACAO`; só `POST /api/agentes/aprovar` com a senha do proprietário executa | texto de agente nunca autoriza |
| Agendamento | Scheduled Functions da Netlify: diária, semanal, mensal (nível 1 apenas) | nativo |

## Mapa dos 12 agentes × dados disponíveis

| Agente | Dados hoje | Situação na etapa 4 |
|---|---|---|
| 00 Coordenador | — | implementado |
| 01 Compras | compras, lista de preços, estoque, giro | implementado (ferramentas de custo, lances, giro, capital) |
| 02 Mercado | nenhuma fonte de preço externa autorizada | **indisponível**; requer lista de fontes e permissão de busca web (custo) |
| 03 Estoque | estoque por lote (sem IMEI/bateria) | implementado com os campos existentes; IMEI fica como campo futuro |
| 04 Precificação | custo, margem, lista de preços | implementado (sem tributos/tarifas, que não existem no sistema) |
| 05 Vendas | vendas, clientes | implementado |
| 06 Financeiro | receitas, custo das vendas, capital em estoque | implementado **parcial**: sem despesas e contas a pagar |
| 07 Crediário | parcelas do BYL (Supabase) | implementado sobre o BYL; Gestão de Aparelhos não tem crediário |
| 08 Garantias | nenhum registro | **indisponível**; requer módulo de garantias |
| 09 Previsão | histórico de vendas (curto) | implementado com média móvel e aviso de incerteza |
| 10 Inteligência comercial | cruzamento dos anteriores | implementado |
| 11 Auditor | — | implementado (revisão com até 2 rodadas) |

## Arquivos

```
gestao-aparelhos/netlify/lib/
  dados.mjs          leitura do estado + cálculos determinísticos (porta de calcRow, stockList, vendaTotals, precoEntrada) + leitura BYL
  ferramentas.mjs    registro de ferramentas com contrato, nível e handler
  tarefas.mjs        fila persistente: criar, transitar estado, dedupe, tentativas, recuperação
  memoria.mjs        memória persistente com índice por palavra/agente/data/tarefa/aparelho/tipo
  agentes.mjs        definição dos 12 agentes, coordenador, loop de ferramentas, auditor, consolidação
gestao-aparelhos/netlify/functions/
  agentes.mjs        /api/agentes/* (status, comando SSE, tarefas, aprovar, memoria)
  rotina-diaria.mjs  scheduled (diária)  → relatório gerencial + alertas (nível 1)
  rotina-semanal.mjs scheduled (semanal) → giro, rentabilidade, reposição
  rotina-mensal.mjs  scheduled (mensal)  → consolidação executiva
gestao-aparelhos/tests/
  *.test.mjs         node:test com store e cliente de IA simulados
gestao-aparelhos/index.html
  aba "Central" (Central de Inteligência — HEROS CELL)
```

Dependências novas: nenhuma além das já instaladas (`@netlify/blobs`, `@anthropic-ai/sdk`). Testes usam `node:test` nativo.

Variáveis de ambiente novas: `SUPABASE_URL` e `SUPABASE_ANON_KEY` (leitura do BYL; opcionais — sem elas o agente de crediário fica indisponível).

## Etapas e critérios de validação

| Etapa | Entrega | Critério |
|---|---|---|
| 1 Diagnóstico | `ARQUITETURA_ATUAL.md` | descreve só o que existe |
| 2 Planejamento | este arquivo | mapa agente×dados, arquivos, riscos |
| 3 Infraestrutura | `dados`, `ferramentas`, `tarefas`, `memoria` | testes: estados, dedupe, recuperação, memória, permissões, cálculos |
| 4 Agentes | `agentes.mjs` | coordenador escolhe agentes; auditor devolve erro; 2 rodadas; indisponíveis respondem o motivo |
| 5 Integração | função `/api/agentes` | comando em linguagem natural produz resultado com dados reais; aprovação só com senha |
| 6 Automações | scheduled functions | rotina grava relatório em memória; pode ser ativada/desativada |
| 7 Interface | aba Central | agentes, tarefas, aprovações, histórico, alertas, erros, comando |
| 8 Validação | `npm test` verde + checagem no site | relatório de limitações |

## Fora de escopo nesta rodada (precisa de decisão do proprietário)

1. RLS e chave de serviço no Supabase do BYL.
2. Módulos novos de dados: fornecedores, IMEI por unidade, despesas, garantias, tarifas/tributos.
3. Busca de preços na web (fontes e orçamento de custo).
4. Envio automático de cobranças/WhatsApp.
