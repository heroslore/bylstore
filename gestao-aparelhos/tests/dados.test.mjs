import { test } from "node:test";
import assert from "node:assert/strict";
import * as D from "../netlify/lib/dados.mjs";
import { estadoExemplo, semearEstado, resetStores } from "./helpers.mjs";

test("cálculo de custo bate com o app (nota 70%, dólar 5,40 e nota 90%, dólar 5,20)", () => {
  const c = D.calcRow({ preco: 233, qty: 1 }, { taxaFixa: 17, notaPct: 70, frete1: 7.5, frete2: 8, cotacao: 5.4 });
  assert.equal(D.round2(c.custoBRL), 1486.51);
  const d = D.calcRow({ preco: 233, notaPct: 90, qty: 1 }, { taxaFixa: 17, notaPct: 70, frete1: 7.5, frete2: 8, cotacao: 5.2 });
  assert.equal(D.round2(d.custoBRL), 1469.02);
  assert.equal(D.round2(d.frete1), 15.73); assert.equal(D.round2(d.frete2), 16.78);
});
test("entrada direta: custo em R$ sem cálculo de leilão", () => {
  const s = estadoExemplo();
  s.compras.push({ id: "c9", nome: "Entrada direta", data: "2026-10-20", settings: s.settings, rows: [{ id: "r9", modelo: "iPhone 15 128GB", preco: 0, custoBRL: 2100, qty: 2 }], origem: "direta" });
  const k = D.calcRow(s.compras[2].rows[0], s.settings);
  assert.equal(k.custoBRL, 2100); assert.ok(k.direto); assert.equal(D.round2(k.lBRL), 4200);
  assert.equal(D.estoqueAgrupado(s).find((g) => g.modelo === "iPhone 15 128GB").qty, 2);
  assert.ok(!D.inconsistencias(s).some((i) => i.tipo === "lance_zerado"));
});
test("estoque desconta vendas e agrupa por modelo com custo médio", () => {
  const s = estadoExemplo();
  const stock = D.stockList(s);
  assert.equal(stock.find((x) => x.rowId === "r1").avail, 2, "5 comprados − 2 vendidos − 1 perda");
  assert.equal(stock.find((x) => x.rowId === "r1").lost, 1);
  assert.equal(stock.find((x) => x.rowId === "r2").avail, 1);
  const g = D.estoqueAgrupado(s).find((x) => x.modelo === "iPhone 13 128GB");
  assert.equal(g.qty, 6); assert.equal(g.lotes.length, 2); assert.equal(g.vendaLista, 1700);
  assert.equal(g.custoMedio, D.round2((2 * 1486.51 + 4 * 1463.09) / 6));
});
test("lucro da venda usa o custo recalculado da compra", () => {
  const s = estadoExemplo();
  const t = D.vendaTotais(s, s.vendas[0]);
  assert.equal(D.round2(t.venda), 3400); assert.equal(D.round2(t.custo), 2973.03); assert.equal(D.round2(t.lucro), 426.97);
});
test("casamento de modelo respeita Pro/Max e não casa por preço igual", () => {
  const s = estadoExemplo();
  assert.equal(D.precoEntrada(s, "iPhone 15 128GB Blue").id, "p3");
  assert.equal(D.precoEntrada(s, "iphone 13 pro max 128gb C").id, "p4");
  assert.equal(D.precoEntrada(s, "iPhone 14 128GB"), null);
});
test("análise de lances: lance máximo para 20% sobre a venda", () => {
  const s = estadoExemplo();
  const r = D.analisarLances(s, { linhas: [{ modelo: "iPhone 14 Pro 128GB", lance: 359 }], margem: 20, base: "venda" })[0];
  assert.equal(r.custoBRL, 2240.74); assert.equal(r.margem, 13.8); assert.equal(r.lanceMaximo, 332.15); assert.equal(r.veredito, "abaixo_da_meta");
});
test("resumo financeiro, giro, parados, previsão e inconsistências", () => {
  const s = estadoExemplo(); const agora = new Date("2026-10-22T12:00:00Z");
  const f = D.resumoFinanceiro(s, { de: "2026-10-01", ate: "2026-10-31" });
  assert.equal(f.vendas, 1); assert.equal(f.faturamento, 2600); assert.equal(f.lucroBruto, D.round2(2600 - 2240.74));
  assert.equal(f.gastos, 100.5); assert.equal(f.perdas, 1486.51); assert.equal(f.perdasAparelhos, 1);
  assert.equal(f.resultadoLiquido, D.round2(2600 - 2240.74 - 100.5 - 1486.51));
  assert.equal(D.gastosPeriodo(s, { compraId: "c2" }).length, 1);
  assert.equal(D.perdasPeriodo(s)[0].imeis[0], "3512345");
  const g = D.giroPorModelo(s, { dias: 90, agora });
  assert.equal(g.modelos.find((m) => m.modelo === "iPhone 13 128GB").vendidosNoPeriodo, 2);
  const p = D.aparelhosParados(s, { dias: 30, agora });
  assert.ok(p.some((x) => x.compra === "Leilão 01/09" && x.diasParado === 51));
  const prev = D.previsaoDemanda(s, { semanas: 8, agora });
  assert.ok(prev.incerteza.startsWith("ALTA"));
  s.vendas.push({ id: "v3", data: "2026-10-20", clienteId: "k1", clienteNome: "Loja do Zé", itens: [{ compraId: "c1", rowId: "r2", modelo: "iPhone 14 Pro 128GB", qty: 5, preco: 2000 }] });
  const inc = D.inconsistencias(s);
  assert.ok(inc.some((i) => i.tipo === "estoque_negativo")); assert.ok(inc.some((i) => i.tipo === "venda_abaixo_do_custo"));
});
test("crediário do BYL: vencidas, recebido, inadimplência", () => {
  const byl = { orcamentos: [{ id: "o1", status: "vendido", venda: 3000, custo: 2000, entrada: 600, venda_data: "2026-08-01", produto: { short: "POCO" }, parcelas: [{ num: 1, venc: "2026-09-05", valor: 400, pago: true }, { num: 2, venc: "2026-10-05", valor: 400, pago: false }, { num: 3, venc: "2026-11-05", valor: 400, pago: false }] }] };
  const c = D.bylCrediario(byl, { agora: new Date("2026-10-22T12:00:00Z") });
  assert.equal(c.recebido, 1000); assert.equal(c.pendente, 800); assert.equal(c.vencido, 400); assert.equal(c.lucroRealizado, -1000); assert.equal(c.contratosEmAtraso.length, 1);
});
test("gravação respeita concorrência otimista", async () => {
  resetStores(); const st = await semearEstado();
  const { dados, updatedAt } = await D.carregarEstado(st);
  const r1 = await D.gravarEstado(st, dados, updatedAt); assert.ok(r1.ok);
  const r2 = await D.gravarEstado(st, dados, updatedAt); assert.ok(r2.conflict);
});
