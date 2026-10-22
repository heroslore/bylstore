import { test } from "node:test";
import assert from "node:assert/strict";
import { executarFerramenta, ferramentasPara, autorizado, executarProposta } from "../netlify/lib/ferramentas.mjs";
import * as D from "../netlify/lib/dados.mjs";
import { getStore } from "./mocks/blobs.mjs";
import { estadoExemplo, semearEstado, resetStores } from "./helpers.mjs";

const ctx = (agente) => ({ state: estadoExemplo(), byl: null, memoria: getStore({ name: "memoria" }), agora: new Date("2026-10-22T12:00:00Z"), agente, tarefa: "TASK-0001" });

test("permissões: ferramenta restrita, nível 3 bloqueado, validação de entrada", async () => {
  assert.ok(autorizado("AGENTE_01_COMPRAS", "analisar_lances"));
  assert.ok(!autorizado("AGENTE_05_VENDAS", "analisar_lances"));
  assert.ok(!autorizado("AGENTE_00_COORDENADOR", "excluir_registro"));
  assert.ok(!ferramentasPara("AGENTE_00_COORDENADOR").some((f) => f.name === "excluir_registro"));
  const neg = await executarFerramenta("analisar_lances", { linhas: [] }, ctx("AGENTE_05_VENDAS"));
  assert.equal(neg.ok, false); assert.match(neg.erro, /não autorizado/);
  const inv = await executarFerramenta("calcular_custo", { lance: "233" }, ctx("AGENTE_01_COMPRAS"));
  assert.equal(inv.ok, false); assert.match(inv.erro, /número/);
  const desconhecido = await executarFerramenta("listar_estoque", { foo: 1 }, ctx("AGENTE_03_ESTOQUE"));
  assert.equal(desconhecido.ok, false);
});
test("nível 1 executa com dados reais; nível 2 só propõe e não altera o estado", async () => {
  resetStores(); await semearEstado();
  const c = ctx("AGENTE_04_PRECIFICACAO");
  const r = await executarFerramenta("listar_estoque", {}, c);
  assert.ok(r.ok); assert.equal(r.resultado.totalAparelhos, 8);
  const p = await executarFerramenta("propor_preco_lista", { modelo: "iPhone 13 128GB", preco: 1750, justificativa: "giro alto" }, c);
  assert.ok(p.ok); assert.equal(p.proposta.tipo, "preco_lista"); assert.ok(p.resultado.aguardando_aprovacao);
  const { dados } = await D.carregarEstado(getStore({ name: "gestao-aparelhos" }));
  assert.equal(dados.precos.find((x) => x.modelo === "iPhone 13 128GB").preco, 1700);
});
test("executarProposta aplica preço e compra com controle de concorrência", async () => {
  resetStores(); const st = await semearEstado();
  const r = await executarProposta(st, { tipo: "preco_lista", modelo: "iPhone 13 128GB", preco: 1750 });
  assert.ok(r.ok);
  const r2 = await executarProposta(st, { tipo: "compra", nome: "Leilão teste", itens: [{ modelo: "iPhone 15 128GB", lance: 375, qty: 3 }] });
  assert.match(r2.descricao, /3 aparelho/);
  const { dados } = await D.carregarEstado(st);
  assert.equal(dados.precos.find((x) => x.modelo === "iPhone 13 128GB").preco, 1750);
  assert.equal(dados.compras[0].nome, "Leilão teste"); assert.equal(dados.compras[0].origem, "agente");
  assert.equal(D.estoqueAgrupado(dados).find((g) => g.modelo === "iPhone 15 128GB").qty, 3);
});
test("memória via ferramenta grava agente e tarefa", async () => {
  resetStores(); const c = ctx("AGENTE_06_FINANCEIRO");
  const r = await executarFerramenta("salvar_memoria", { titulo: "Capital parado", conteudo: "R$ 10 mil", tipo: "alerta", palavras: ["capital"] }, c);
  assert.ok(r.ok);
  const b = await executarFerramenta("buscar_memoria", { consulta: "capital" }, c);
  assert.equal(b.resultado[0].agente, "AGENTE_06_FINANCEIRO"); assert.equal(b.resultado[0].tarefa, "TASK-0001");
});
