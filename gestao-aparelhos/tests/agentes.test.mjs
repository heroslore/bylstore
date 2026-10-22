import { test } from "node:test";
import assert from "node:assert/strict";
import { executarComando, decidirProposta, listaAgentes, executarAgente, criarContexto } from "../netlify/lib/agentes.mjs";
import * as T from "../netlify/lib/tarefas.mjs";
import { listarRecentes } from "../netlify/lib/memoria.mjs";
import { criarClienteMock } from "./mocks/anthropic.mjs";
import { getStore } from "./mocks/blobs.mjs";
import { semearEstado, resetStores } from "./helpers.mjs";

const memoria = () => getStore({ name: "memoria" });
const fila = () => getStore({ name: "agentes" });

test("agentes indisponíveis respondem o motivo sem chamar IA", async () => {
  resetStores(); const st = await semearEstado();
  const ctx = await criarContexto({ st, memoria: memoria() });
  const r = await executarAgente({ cliente: criarClienteMock(), agente: "AGENTE_08_GARANTIAS", instrucao: "x", ctx });
  assert.ok(r.indisponivel); assert.match(r.texto, /garantias/i);
  assert.equal(listaAgentes().filter((a) => a.disponivel).length, 10);
});
test("fluxo completo: coordenador → especialista → auditor → consolidação, com evidências e memória", async () => {
  resetStores(); const st = await semearEstado();
  const cliente = criarClienteMock(); const eventos = [];
  const t = await executarComando({ cliente, comando: "Liste meu estoque", st, memoria: memoria(), onEvento: (e) => eventos.push(e) });
  assert.equal(t.status, "CONCLUIDA"); assert.equal(t.result.texto, "RESPOSTA FINAL CONSOLIDADA");
  assert.ok(eventos.some((e) => e.tipo === "plano")); assert.ok(eventos.some((e) => e.tipo === "ferramenta" && e.ferramenta === "listar_estoque"));
  const sub = await T.obterTarefa(fila(), t.subtarefas[0]);
  assert.equal(sub.status, "CONCLUIDA"); assert.ok(sub.evidence.length >= 2); assert.ok(sub.evidence[0].resumo.includes("totalAparelhos"));
  assert.ok(sub.log.some((l) => l.msg.startsWith("auditoria")));
  const mem = await listarRecentes(memoria(), { tipo: "analise" }); assert.equal(mem.length, 1); assert.equal(mem[0].tarefa, t.task_id);
});
test("execução paralela de agentes independentes e sequencial com dependência", async () => {
  resetStores(); const st = await semearEstado();
  const paralelo = criarClienteMock({ latenciaMs: 30, plano: { interpretacao: "x", agentes: [{ id: "AGENTE_03_ESTOQUE", instrucao: "a", dependeDe: [] }, { id: "AGENTE_05_VENDAS", instrucao: "b", dependeDe: [] }] } });
  const t1 = await executarComando({ cliente: paralelo, comando: "paralelo", st, memoria: memoria() });
  assert.equal(t1.status, "CONCLUIDA"); assert.ok(paralelo.maxAtivos >= 2, "deveria rodar em paralelo");
  const seq = criarClienteMock({ latenciaMs: 30, plano: { interpretacao: "x", agentes: [{ id: "AGENTE_03_ESTOQUE", instrucao: "a", dependeDe: [] }, { id: "AGENTE_01_COMPRAS", instrucao: "b", dependeDe: ["AGENTE_03_ESTOQUE"] }] } });
  const t2 = await executarComando({ cliente: seq, comando: "sequencial", st, memoria: memoria() });
  assert.equal(t2.status, "CONCLUIDA"); assert.equal(seq.maxAtivos, 1, "deveria rodar um de cada vez");
  const comprasCall = seq.chamadas.find((c) => c.ultimo.role === "user" && typeof c.ultimo.content === "string" && c.ultimo.content.includes("CONTEXTO DE OUTROS AGENTES"));
  assert.ok(comprasCall, "o segundo agente recebe o resultado do primeiro");
});
test("auditor reprova, agente corrige, até 2 rodadas; na terceira reprovação a subtarefa falha", async () => {
  resetStores(); const st = await semearEstado();
  const c1 = criarClienteMock({ rejeicoesAuditor: 1 });
  const t1 = await executarComando({ cliente: c1, comando: "corrige uma vez", st, memoria: memoria() });
  const s1 = await T.obterTarefa(fila(), t1.subtarefas[0]);
  assert.equal(s1.status, "CONCLUIDA"); assert.match(s1.result.texto, /CORRIGIDA/);
  const c2 = criarClienteMock({ rejeicoesAuditor: 5 });
  const t2 = await executarComando({ cliente: c2, comando: "nunca aprova", st, memoria: memoria() });
  const s2 = await T.obterTarefa(fila(), t2.subtarefas[0]);
  assert.equal(s2.status, "FALHOU"); assert.equal(s2.error.codigo, "REPROVADO_AUDITOR"); assert.equal(s2.tentativas, 3);
  assert.equal(t2.status, "CONCLUIDA", "o coordenador consolida informando a reprovação");
});
test("proposta de nível 2 vira tarefa AGUARDANDO_APROVACAO; aprovar executa, rejeitar cancela", async () => {
  resetStores(); const st = await semearEstado();
  const cliente = criarClienteMock({ proporPreco: true, plano: { interpretacao: "x", agentes: [{ id: "AGENTE_04_PRECIFICACAO", instrucao: "ajuste preço", dependeDe: [] }] } });
  const t = await executarComando({ cliente, comando: "ajuste o preço do 13", st, memoria: memoria() });
  assert.equal(t.status, "AGUARDANDO_APROVACAO"); assert.equal(t.result.propostas.length, 1);
  const pend = await T.listarTarefas(fila(), { status: "AGUARDANDO_APROVACAO" });
  const prop = pend.find((x) => x.requires_approval); assert.ok(prop); assert.equal(prop.proposta.preco, 1750);
  const { dados: antes } = await (await import("../netlify/lib/dados.mjs")).carregarEstado(st);
  assert.equal(antes.precos[0].preco, 1700, "nada muda antes da aprovação");
  const ok = await decidirProposta({ task_id: prop.task_id, decisao: "aprovar", st, memoria: memoria() });
  assert.equal(ok.status, "CONCLUIDA");
  const { dados: depois } = await (await import("../netlify/lib/dados.mjs")).carregarEstado(st);
  assert.equal(depois.precos[0].preco, 1750);
  await assert.rejects(() => decidirProposta({ task_id: prop.task_id, decisao: "aprovar", st, memoria: memoria() }));
  const cliente2 = criarClienteMock({ proporPreco: true, plano: { interpretacao: "x", agentes: [{ id: "AGENTE_04_PRECIFICACAO", instrucao: "outro", dependeDe: [] }] } });
  const t2 = await executarComando({ cliente: cliente2, comando: "outro ajuste", st, memoria: memoria() });
  const prop2 = (await T.listarTarefas(fila(), { status: "AGUARDANDO_APROVACAO" })).find((x) => x.requires_approval);
  const rej = await decidirProposta({ task_id: prop2.task_id, decisao: "rejeitar", motivo: "não", st, memoria: memoria() });
  assert.equal(rej.status, "CANCELADA");
  const decisoes = await listarRecentes(memoria(), { tipo: "decisao" }); assert.equal(decisoes.length, 1);
});
test("comando repetido dentro da janela não é duplicado e tarefa interrompida é recuperada", async () => {
  resetStores(); const st = await semearEstado();
  const { tarefa } = await T.criarTarefa(fila(), { agente: "AGENTE_00_COORDENADOR", acao: "COMANDO", input: { comando: "repetido" }, maxTentativas: 1 });
  await T.transitar(fila(), tarefa, "EM_EXECUCAO");
  const dup = await executarComando({ cliente: criarClienteMock(), comando: "repetido", st, memoria: memoria() });
  assert.equal(dup.task_id, tarefa.task_id, "devolve a tarefa já ativa");
  const velha = await T.obterTarefa(fila(), tarefa.task_id);
  velha.iniciadaEm = new Date(Date.now() - 60 * 60 * 1000).toISOString(); await T.salvarTarefa(fila(), velha);
  const nova = await executarComando({ cliente: criarClienteMock(), comando: "repetido", st, memoria: memoria() });
  const recuperada = await T.obterTarefa(fila(), tarefa.task_id);
  assert.equal(recuperada.status, "FALHOU"); assert.equal(recuperada.error.codigo, "INTERROMPIDA");
  assert.notEqual(nova.task_id, tarefa.task_id); assert.equal(nova.status, "CONCLUIDA");
});
test("falha de ferramenta não some: vai como is_error ao agente e fica na evidência", async () => {
  resetStores(); const st = await semearEstado();
  const cliente = criarClienteMock({ plano: { interpretacao: "x", agentes: [{ id: "AGENTE_05_VENDAS", instrucao: "a", dependeDe: [] }] }, ferramentasPorAgente: { "Você é o Analista de Vendas. Mede faturame": [["analisar_lances", { linhas: [] }]] } });
  const t = await executarComando({ cliente, comando: "teste erro", st, memoria: memoria() });
  const sub = await T.obterTarefa(fila(), t.subtarefas[0]);
  assert.equal(sub.evidence[0].ok, false); assert.match(sub.evidence[0].resumo, /não autorizado/); assert.match(sub.result.texto, /Ferramenta com erro/);
});
