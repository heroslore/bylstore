// testes/agentes.test.mjs — os 12 testes obrigatórios do prompt mestre.
// Rodar: node --test testes/
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { montar, relogio, DONO, ESTOQUE, VENDA } from "./apoio.js";
import { ArmazemArquivo, ArmazemMemoria } from "../agentes/nucleo/armazem.js";
import { Fila, ESTADOS } from "../agentes/nucleo/fila.js";
import { Memoria } from "../agentes/nucleo/memoria.js";
import { Auditoria } from "../agentes/nucleo/auditoria.js";
import { ESPECIALISTAS } from "../agentes/especialistas.js";
import * as C from "../core/calculos.js";

test("1. comunicação coordenador ↔ agentes por mensagens estruturadas", async () => {
  const { c } = montar();
  const r = await c.pedido("Analise meu estoque e identifique os cinco aparelhos com menor rentabilidade");
  assert.equal(r.status, ESTADOS.CONCLUIDA);
  assert.deepEqual(r.resultados.map((x) => x.agente), ["AGENTE_03_ESTOQUE", "AGENTE_04_PRECIFICACAO"]);
  const t = c.fila.obter(r.resultados[1].task_id);
  for (const campo of ["task_id", "agent", "action", "input", "status", "requires_approval", "result", "evidence", "error"]) assert.ok(campo in t, campo);
  assert.equal(t.input.top, 5);
  assert.equal(t.parent_id, r.pedido);
  assert.ok(t.evidence.some((e) => e.ferramenta === "ler_estoque" && e.fonte === "fixture" && e.consultado_em));
});

test("2. execução sequencial respeita dependências", async () => {
  const { c } = montar();
  const ordem = [];
  const orig = c._executar.bind(c);
  c._executar = async (id) => { ordem.push(c.fila.obter(id).agent); return orig(id); };
  await c.pedido("x", { plano: [
    { agent: "AGENTE_03_ESTOQUE", action: "RESUMO_ESTOQUE", input: {} },
    { agent: "AGENTE_10_INTELIGENCIA", action: "CRUZAR", input: {}, depende: [0] },
  ] });
  assert.deepEqual(ordem, ["AGENTE_03_ESTOQUE", "AGENTE_10_INTELIGENCIA"]);
});

test("3. tarefas independentes rodam em paralelo", async () => {
  const { c } = montar();
  let ativas = 0, pico = 0;
  const lento = (id) => ({ id, nome: id, acoes: { A: {
    descricao: "teste",
    async executar(_i, ctx) {
      ativas++; pico = Math.max(pico, ativas);
      await ctx.usar("ler_estoque", {});
      await new Promise((r) => setTimeout(r, 30));
      ativas--;
      return { resumo: "ok", metricas: [], recomendacoes: [], limitacoes: [], dados_insuficientes: false };
    },
  } } });
  c.agentes.set("AGENTE_03_ESTOQUE", lento("AGENTE_03_ESTOQUE"));
  c.agentes.set("AGENTE_05_VENDAS", lento("AGENTE_05_VENDAS"));
  const r = await c.pedido("x", { plano: [{ agent: "AGENTE_03_ESTOQUE", action: "A" }, { agent: "AGENTE_05_VENDAS", action: "A" }] });
  assert.equal(pico, 2);
  assert.equal(r.status, ESTADOS.CONCLUIDA);
});

test("4. auditor reprova número errado, devolve ao agente e para após 2 rodadas", async () => {
  const { c } = montar();
  const real = ESPECIALISTAS.find((a) => a.id === "AGENTE_03_ESTOQUE").acoes.RESUMO_ESTOQUE;
  let chamadas = 0;
  c.agentes.set("AGENTE_03_ESTOQUE", { id: "AGENTE_03_ESTOQUE", nome: "x", acoes: { RESUMO_ESTOQUE: {
    ...real,
    async executar(input, ctx) {
      chamadas++;
      const r = await real.executar(input, ctx);
      r.metricas.find((x) => x.nome === "capital_em_estoque").valor = 99999; // número inventado
      return r;
    },
  } } });
  const r = await c.pedido("estoque");
  assert.equal(chamadas, 3); // original + 2 correções
  assert.equal(r.resultados[0].status, ESTADOS.FALHOU);
  assert.match(r.resultados[0].erro, /capital_em_estoque não confere/);
  assert.equal(c.memoria.buscar({ texto: "reprovação", tipo: "erro" }).length, 1);

  // Corrigido na 2ª tentativa: aprovado.
  const { c: c2 } = montar();
  let n = 0;
  c2.agentes.set("AGENTE_03_ESTOQUE", { id: "AGENTE_03_ESTOQUE", nome: "x", acoes: { RESUMO_ESTOQUE: {
    ...real,
    async executar(input, ctx) {
      const r = await real.executar(input, ctx);
      if (n++ === 0) r.metricas[0].metodo = "";
      return r;
    },
  } } });
  const r2 = await c2.pedido("estoque");
  assert.equal(r2.resultados[0].status, ESTADOS.CONCLUIDA);
  assert.equal(r2.resultados[0].auditoria.rodada, 1);
});

test("5. falha temporária é tentada de novo; falha permanente fica registrada", async () => {
  const { c } = montar();
  let n = 0;
  c.agentes.set("AGENTE_05_VENDAS", { id: "AGENTE_05_VENDAS", nome: "x", acoes: { R: {
    descricao: "t",
    async executar(_i, ctx) {
      if (n++ < 1) throw new Error("rede caiu");
      await ctx.usar("ler_orcamentos", {});
      return { resumo: "ok", metricas: [], recomendacoes: [], limitacoes: [], dados_insuficientes: false };
    },
  } } });
  const r = await c.pedido("x", { plano: [{ agent: "AGENTE_05_VENDAS", action: "R" }] });
  assert.equal(r.resultados[0].status, ESTADOS.CONCLUIDA);
  assert.equal(c.fila.obter(r.resultados[0].task_id).tentativas, 2);

  c.agentes.set("AGENTE_05_VENDAS", { id: "AGENTE_05_VENDAS", nome: "x", acoes: { R: { descricao: "t", async executar() { throw new Error("sempre falha"); } } } });
  const r2 = await c.pedido("y", { plano: [{ agent: "AGENTE_05_VENDAS", action: "R" }] });
  assert.equal(r2.resultados[0].status, ESTADOS.FALHOU);
  assert.equal(c.fila.obter(r2.resultados[0].task_id).tentativas, 3);
  assert.equal(r2.status, ESTADOS.FALHOU);
  assert.ok(c.estado().erros.some((e) => e.erro === "sempre falha"));
});

test("6. memória persiste em arquivo e a busca é indexada", () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const caminho = join(dir, "agentes.json");
  const m1 = new Memoria(new ArmazemArquivo(caminho));
  m1.salvar({ tipo: "regra_comercial", assunto: "Margem mínima", texto: "Margem mínima de 30% nos Android novos", agente: "AGENTE_04_PRECIFICACAO", palavras: ["precificação"] });
  m1.salvar({ tipo: "fornecedor", assunto: "Fornecedor Paraguai", texto: "Entrega em 7 dias, frete por conta da loja", aparelho_id: "126141-7" });
  m1.salvar({ tipo: "decisao", assunto: "Promoção", texto: "Sem promoção em outubro" });

  const m2 = new Memoria(new ArmazemArquivo(caminho)); // "reinício"
  const r = m2.buscar({ texto: "margem mínima android" });
  assert.equal(r[0].assunto, "Margem mínima");
  assert.equal(m2.buscar({ aparelho_id: "126141-7" })[0].tipo, "fornecedor");
  assert.equal(m2.buscar({ agente: "AGENTE_04_PRECIFICACAO" }).length, 1);
  assert.equal(m2.buscar({ texto: "inexistente" }).length, 0);
  assert.throws(() => m2.salvar({ tipo: "estoque", assunto: "x", texto: "y" }), /tipo de memória inválido/);
});

test("7. permissões: agente não autorizado é barrado e nível 2 não roda sem aprovação", async () => {
  const { c } = montar();
  await assert.rejects(c.ferramentas.executar("ler_estoque", {}, { agente: "AGENTE_02_MERCADO", task_id: "T" }), /não pode usar/);
  await assert.rejects(c.ferramentas.executar("registrar_entrada_estoque", { cod: "126141-7", qtd: 1, custoUnitario: 600 }, { agente: "AGENTE_03_ESTOQUE", task_id: "T" }), /precisa de aprovação/);
  await assert.rejects(c.ferramentas.executar("ler_orcamentos", { status: "qualquer" }, { agente: "AGENTE_07_CREDIARIO", task_id: "T" }), /precisa ser um de/);
  const neg = c.solicitarOperacao({ agente: "AGENTE_05_VENDAS", ferramenta: "registrar_entrada_estoque", input: { cod: "126141-7", qtd: 1, custoUnitario: 600 }, resumo: "x" });
  assert.equal(neg.tarefa.status, ESTADOS.FALHOU);
  assert.ok(c.auditoria.verificar().ok);
});

test("8. cálculos financeiros: markup ≠ margem, preço mínimo, parcelas e lucro", () => {
  assert.equal(C.markup(250, 100), 1.5);
  assert.equal(C.margemBruta(250, 100), 0.6);
  assert.equal(C.custoAquisicao({ usd: 118, cotacao: 5.37 }), 633.66);
  assert.equal(C.custoMedio({ qtd: 4, custoTotal: 2534.64 }), 633.66);
  assert.equal(C.precoMinimo({ custo: 700, margemMinima: 0.2, taxaPct: 0.05 }), 933.33);
  assert.deepEqual(C.planoParcelado(1000, C.PLANOS_PADRAO.p8), { n: 8, total: 1100, entrada: 275, parcela: 103.13 });
  const mc = C.margemContribuicao({ preco: 1000, custo: 600, taxaPct: 0.02, garantiaEstimada: 30 });
  assert.equal(mc.valor, 350);
  // Mesma regra do index.html: venda em 01/09 com vencimento dia 5 → 1ª parcela de 4 dias.
  const p = C.gerarParcelas("2026-09-01", 5, 3, 351.08);
  assert.deepEqual(p.map((x) => [x.venc, x.valor]), [["2026-09-05", 46.81], ["2026-10-05", 351.08], ["2026-11-05", 351.08]]);
  const s = C.situacaoVenda({ ...VENDA, parcelas: VENDA.parcelas }, "2026-10-22");
  assert.equal(s.recebido, 859.02);
  assert.equal(s.atrasado, 351.08);
  assert.equal(s.lucroRealizado, -322.38);
  assert.equal(s.lucroEsperado, 379.78);
  assert.ok(s.diferencaDoPlano < 0); // 1ª parcela proporcional reduz o total do contrato
  assert.throws(() => C.precoMinimo({ custo: 1, margemMinima: 0.9, taxaPct: 0.2 }), /100%/);
});

test("9. atualização de estoque só acontece com aprovação do proprietário", async () => {
  const { c, fonte } = montar();
  const input = { cod: "126141-7", qtd: 2, custoUnitario: 640 };
  const { tarefa, aprovacao } = c.solicitarOperacao({ agente: "AGENTE_03_ESTOQUE", ferramenta: "registrar_entrada_estoque", input, resumo: "entrada de 2 POCO M7" });
  assert.equal(tarefa.status, ESTADOS.AGUARDANDO_APROVACAO);
  assert.equal(fonte.escritas.length, 0);
  c.aprovacoes.decidir(aprovacao.id, DONO, { aprovar: true });
  const feita = await c.executarAprovada(tarefa.task_id, aprovacao.id);
  assert.equal(feita.status, ESTADOS.CONCLUIDA);
  const item = (await fonte.estoque()).find((e) => e.cod === "126141-7");
  assert.equal(item.qtd, 6);
  assert.equal(item.custoTotal, 3814.64);
  assert.ok(feita.evidence.some((e) => e.ferramenta === "registrar_entrada_estoque" && e.aprovacao_id === aprovacao.id));
  // A mesma aprovação não serve duas vezes.
  await assert.rejects(c.ferramentas.executar("registrar_entrada_estoque", input, { agente: "AGENTE_03_ESTOQUE", task_id: tarefa.task_id, aprovacao_id: aprovacao.id }), /já foi usada/);
});

test("10. operações duplicadas são evitadas", async () => {
  const { c, fonte } = montar();
  const input = { cod: "116860-0", qtd: 1, custoUnitario: 830 };
  const a = c.solicitarOperacao({ agente: "AGENTE_03_ESTOQUE", ferramenta: "registrar_entrada_estoque", input, resumo: "x" });
  const b = c.solicitarOperacao({ agente: "AGENTE_03_ESTOQUE", ferramenta: "registrar_entrada_estoque", input, resumo: "x" });
  assert.equal(b.duplicada, true);
  assert.equal(b.tarefa.task_id, a.tarefa.task_id);
  assert.equal(c.aprovacoes.pendentes().length, 1);
  c.aprovacoes.decidir(a.aprovacao.id, DONO, { aprovar: true });
  await c.executarAprovada(a.tarefa.task_id, a.aprovacao.id);
  await assert.rejects(c.executarAprovada(a.tarefa.task_id, a.aprovacao.id), /CONCLUIDA/);
  assert.equal(fonte.escritas.length, 1);
  // Duas execuções simultâneas da mesma tarefa: só uma reserva.
  const f = new Fila(new ArmazemMemoria());
  const t = f.criar({ agent: "A", action: "B" });
  assert.ok(f.iniciar(t.task_id, "x"));
  assert.equal(f.iniciar(t.task_id, "y"), null);
});

test("11. aprovação: só o proprietário autenticado; texto de agente não vale; nível 3 pede código", async () => {
  const { c, fonte } = montar();
  const { tarefa, aprovacao } = c.solicitarOperacao({ agente: "AGENTE_07_CREDIARIO", ferramenta: "excluir_orcamento", input: { id: "o1" }, resumo: "excluir" });
  assert.ok(aprovacao.codigo_confirmacao);
  assert.throws(() => c.aprovacoes.decidir(aprovacao.id, { tipo: "agente", agente: "AGENTE_11_AUDITOR", papel: "proprietario", autenticado: true, usuario: "auditor" }, { aprovar: true }), /só o proprietário/);
  assert.throws(() => c.aprovacoes.decidir(aprovacao.id, { ...DONO, autenticado: false }, { aprovar: true }), /só o proprietário/);
  assert.throws(() => c.aprovacoes.decidir(aprovacao.id, DONO, { aprovar: true }), /código de confirmação/);
  await assert.rejects(c.executarAprovada(tarefa.task_id, aprovacao.id), /sem aprovação/);
  assert.equal(fonte.escritas.length, 0);
  c.aprovacoes.decidir(aprovacao.id, DONO, { aprovar: true, confirmacao: aprovacao.codigo_confirmacao });
  await c.executarAprovada(tarefa.task_id, aprovacao.id);
  assert.equal((await fonte.orcamentos()).length, 0);
  const trilha = c.auditoria.listar().map((r) => r.acao);
  assert.ok(trilha.includes("APROVACAO_RECUSADA_SEM_PERMISSAO") && trilha.includes("APROVACAO_CONCEDIDA"));
  // Aprovação expira.
  const { c: c2 } = montar();
  const op = c2.solicitarOperacao({ agente: "AGENTE_03_ESTOQUE", ferramenta: "registrar_entrada_estoque", input: { cod: "116860-0", qtd: 1, custoUnitario: 1 }, resumo: "x" });
  c2.relogio = () => new Date("2026-10-30T00:00:00");
  c2.aprovacoes.relogio = c2.relogio;
  assert.throws(() => c2.aprovacoes.decidir(op.aprovacao.id, DONO, { aprovar: true }), /expirou/);
});

test("12. tarefa interrompida é recuperada após reinício do processo", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fila-"));
  const caminho = join(dir, "agentes.json");
  const rel = relogio();
  const f1 = new Fila(new ArmazemArquivo(caminho), { relogio: rel.fn, prazoExecucaoMs: 60_000 });
  const t = f1.criar({ agent: "AGENTE_03_ESTOQUE", action: "RESUMO_ESTOQUE" });
  f1.iniciar(t.task_id, "COORDENADOR"); // processo "morre" aqui

  rel.avancar(5 * 60_000);
  const { c } = montar({ armazem: new ArmazemArquivo(caminho), rel });
  await c.processar();
  const depois = c.fila.obter(t.task_id);
  assert.equal(depois.status, ESTADOS.CONCLUIDA);
  assert.equal(depois.tentativas, 2);
  assert.ok(depois.log.some((l) => l.de === ESTADOS.EM_EXECUCAO && l.para === ESTADOS.PENDENTE));
});

test("extra: dados insuficientes são declarados, não inventados", async () => {
  const { c } = montar({ orcamentos: [] });
  const r = await c.pedido("previsão de demanda, garantias e concorrência");
  assert.deepEqual(r.resultados.map((x) => x.agente), ["AGENTE_02_MERCADO", "AGENTE_08_GARANTIAS", "AGENTE_09_DEMANDA"]);
  for (const x of r.resultados) {
    assert.equal(x.status, ESTADOS.CONCLUIDA);
    assert.equal(x.dados_insuficientes, true);
    assert.equal(x.metricas.length, 0);
    assert.ok(x.limitacoes.length > 0);
  }
});

test("extra: trilha de auditoria detecta adulteração", () => {
  const a = new ArmazemMemoria();
  const au = new Auditoria(a);
  au.registrar({ ator: "x", acao: "A" });
  au.registrar({ ator: "x", acao: "B" });
  assert.ok(au.verificar().ok);
  a.atualizar("auditoria", "00000001", (r) => ({ ...r, acao: "Z" }));
  assert.equal(au.verificar().ok, false);
});

test("extra: rotinas agendadas rodam uma vez por período e podem ser desativadas", async () => {
  const { Rotinas } = await import("../agentes/rotinas.js");
  const rel = relogio("2026-10-22T09:00:00");
  const { c } = montar({ rel });
  const ro = new Rotinas(c);
  ro.desativar("semanal");
  const r1 = await ro.tick();
  assert.deepEqual(r1.map((x) => x.status), [ESTADOS.CONCLUIDA]); // só a diária (22/10 não é dia 1 nem segunda)
  assert.equal((await ro.tick()).length, 0);
  rel.avancar(24 * 3600_000);
  assert.equal((await ro.tick()).length, 1);
  assert.equal(ro.resultados("diaria").length, 2);
});
