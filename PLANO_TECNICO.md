# PLANO TÉCNICO — Camada multiagente da BYL STORE / Heros Cell

Etapa 2 (planejamento). Base: `ARQUITETURA_ATUAL.md` de 22/10/2026.
Regra principal: **não recriar o programa**. O `index.html` continua funcionando como está; os agentes
entram como uma camada nova, ao lado.

## 1. Decisões de arquitetura

| Decisão | Escolha | Por quê |
|---|---|---|
| Linguagem | JavaScript (ESM), Node 20+ | é a linguagem do programa e do `byl-whatsapp` |
| Bibliotecas | **nenhuma nova** | `fetch` nativo para Supabase e Anthropic; testes com `node --test` |
| Servidor | funções serverless na Vercel (`api/`) + cron | mesmo padrão do `byl-whatsapp`; a página estática não pode guardar chaves |
| Banco | o mesmo Supabase, **tabelas novas** com prefixo `agente_` | o banco continua sendo a fonte oficial; nada existente é alterado |
| IA | API da Anthropic, chave só em variável de ambiente | a IA interpreta o pedido e explica; **os números vêm de funções determinísticas** |
| Acesso dos agentes | por ferramentas registradas, cada uma com nível, contrato e lista de agentes autorizados | nenhum agente fala direto com o banco |

Fluxo: **Coordenador → agentes especializados → Auditor → Coordenador → execução (nível 1) ou pedido de aprovação (níveis 2 e 3).**

## 2. Arquivos e módulos

```
core/
  calculos.js              cálculos financeiros únicos (markup, margem, parcelas, lucro, ROI), usados por página e agentes
agentes/
  nucleo/
    armazem.js             persistência: memória (testes) e Supabase (produção), mesma interface
    fila.js                fila de tarefas: estados, tentativas, dependências, idempotência, recuperação
    mensagens.js           formato das mensagens (task_id, agent, action, input, status, result, evidence, error)
    ferramentas.js         registro de ferramentas com contrato de entrada/saída, nível 1/2/3 e agentes autorizados
    permissoes.js          regra de nível; aprovação só do proprietário autenticado
    auditoria.js           trilha de auditoria somente-acréscimo
    memoria.js             memória persistente indexada (palavra-chave, assunto, agente, data, tarefa, aparelho, operação)
    llm.js                 chamada à Anthropic (opcional; sem chave o sistema roda só com regras)
  ferramentas/
    leitura.js             leitura segura de estoque, orçamentos, parcelas (somente leitura)
  coordenador.js           Agente 00: interpreta, planeja, despacha, controla dependências, consolida
  auditor.js               Agente 11: confere cálculos, origem, permissões; até 2 rodadas de correção
  especialistas/
    compras.js  mercado.js  estoque.js  precificacao.js  vendas.js  financeiro.js
    crediario.js  garantias.js  demanda.js  inteligencia.js
  rotinas.js               automações diária / semanal / mensal (ativar, desativar, agendar, consultar)
api/
  central/comando.js       comando em linguagem natural → coordenador
  central/estado.js        agentes, tarefas, alertas, aprovações, erros
  central/aprovar.js       aprovar ou recusar (exige login do proprietário)
  cron/diario.js           rotina diária
supabase/migracoes/
  001_agentes.sql          tabelas novas: agente_tarefas, agente_memoria, agente_auditoria, agente_aprovacoes, agente_rotinas
  002_cadastros.sql        (depois, com aprovação) aparelhos com IMEI, fornecedores, clientes, vendas, garantias, despesas
central.html               CENTRAL DE INTELIGÊNCIA — HEROS CELL (link no menu do programa)
testes/                    os 12 testes obrigatórios
```

## 3. Etapas, entregas e critério de aceite

| Etapa | Entrega | Critério de aceite | Precisa de aprovação do Ygor? |
|---|---|---|---|
| 3 Infraestrutura | núcleo (`agentes/nucleo/*`), `core/calculos.js`, SQL 001 | 12 testes passando em ambiente isolado, sem tocar no banco real | Rodar o SQL 001 no Supabase (só cria tabelas novas) |
| 4 Agentes | coordenador, auditor e os 10 especialistas | cada agente devolve resultado com dados, origem, data, método, limitações; auditor reprova número inventado | não |
| 5 Integração | ferramentas de leitura ligadas às tabelas `estoque` e `orcamentos` | relatório com os 9 produtos reais bate com a tela do programa | Configurar a Vercel e as chaves (Supabase service e Anthropic) |
| 6 Automações | rotinas diária/semanal/mensal | cron roda, grava relatório, falha fica registrada | não |
| 7 Interface | `central.html` + link no `index.html` | comando "liste estoque zerado" responde com dados reais | mudar o `index.html` (só um link no menu) |
| 8 Validação | relatório de testes | todos verdes; nenhuma operação real nos testes | não |
| Segurança do banco | login + RLS fechando acesso anônimo | página continua funcionando com login | **sim** (muda como a página acessa o banco) |
| Cadastros novos | SQL 002 + telas de aparelho/IMEI, cliente, fornecedor, garantia, despesa | aditivo, sem apagar nada | **sim** |

## 4. Regras que o código garante

- Estados: `PENDENTE`, `EM_EXECUCAO`, `AGUARDANDO_REVISAO`, `AGUARDANDO_APROVACAO`, `CONCLUIDA`, `FALHOU`, `CANCELADA`.
- `CONCLUIDA` só com evidência de execução real (resultado da ferramenta registrado).
- Chave de idempotência por tarefa: o mesmo pedido não roda duas vezes.
- Tarefa presa em `EM_EXECUCAO` além do prazo volta para `PENDENTE` (recuperação após interrupção).
- Falha nunca some: vai para `FALHOU` com erro e fica na Central.
- Nível 2 e 3 só executam com aprovação gravada por usuário humano autenticado; texto de agente não vale como aprovação.
- IMEI só aparece mascarado (`35*********1234`) para agentes; completo só para o proprietário.

## 5. Informações que preciso do Ygor

1. O programa é este `bylstore` mesmo, ou existe outro (em qual pasta do PC)?
2. Um sistema só para BYL STORE e Heros Cell, ou separados?
3. Pode usar a Vercel (como no `byl-whatsapp`) para o servidor dos agentes?
