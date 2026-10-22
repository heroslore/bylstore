import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "../netlify/lib/tarefas.mjs";
import { getStore } from "./mocks/blobs.mjs";
import { resetStores } from "./helpers.mjs";

test("cria, transita e registra log; transições inválidas são bloqueadas", async () => {
  resetStores(); const st = getStore({ name: "agentes" });
  const { tarefa } = await T.criarTarefa(st, { agente: "AGENTE_03_ESTOQUE", acao: "ANALISAR", input: { x: 1 } });
  assert.equal(tarefa.task_id, "TASK-0001"); assert.equal(tarefa.status, "PENDENTE");
  await T.transitar(st, tarefa, "EM_EXECUCAO"); assert.equal(tarefa.tentativas, 1);
  await assert.rejects(() => T.transitar(st, tarefa, "PENDENTE_X"));
  await T.transitar(st, tarefa, "CONCLUIDA", { result: { ok: true } });
  await assert.rejects(() => T.transitar(st, tarefa, "EM_EXECUCAO"));
  const lida = await T.obterTarefa(st, "TASK-0001");
  assert.equal(lida.status, "CONCLUIDA"); assert.ok(lida.log.length >= 3);
});
test("prevenção de duplicadas dentro da janela", async () => {
  resetStores(); const st = getStore({ name: "agentes" });
  const a = await T.criarTarefa(st, { agente: "A", acao: "X", input: { q: 1 } });
  const b = await T.criarTarefa(st, { agente: "A", acao: "X", input: { q: 1 } });
  assert.equal(b.duplicada, true); assert.equal(b.tarefa.task_id, a.tarefa.task_id);
  await T.transitar(st, a.tarefa, "CANCELADA");
  const c = await T.criarTarefa(st, { agente: "A", acao: "X", input: { q: 1 } });
  assert.equal(c.duplicada, false);
});
test("recuperação de tarefas interrompidas: reagenda e depois falha", async () => {
  resetStores(); const st = getStore({ name: "agentes" });
  const { tarefa } = await T.criarTarefa(st, { agente: "A", acao: "X", input: {}, maxTentativas: 2 });
  await T.transitar(st, tarefa, "EM_EXECUCAO");
  const r1 = await T.recuperarInterrompidas(st, { limiteMs: 1000, agora: Date.now() + 5000 });
  assert.equal(r1.length, 1); assert.equal(r1[0].status, "PENDENTE"); assert.equal(r1[0].error.codigo, "INTERROMPIDA");
  const t2 = await T.obterTarefa(st, tarefa.task_id);
  await T.transitar(st, t2, "EM_EXECUCAO");
  const r2 = await T.recuperarInterrompidas(st, { limiteMs: 1000, agora: Date.now() + 5000 });
  assert.equal(r2[0].status, "FALHOU");
});
test("persistência: outra instância do store lê a mesma fila", async () => {
  resetStores(); const st = getStore({ name: "agentes" });
  await T.criarTarefa(st, { agente: "A", acao: "X", input: { n: 1 } });
  await T.criarTarefa(st, { agente: "A", acao: "Y", input: { n: 2 } });
  const outra = getStore({ name: "agentes" });
  const lista = await T.listarTarefas(outra);
  assert.equal(lista.length, 2); assert.equal(lista[0].task_id, "TASK-0002");
});
