// testes/servidor.test.mjs — Central de Inteligência local: login obrigatório e aprovação pela API.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { criarApp } from "../agentes/servidor.js";
import { Rotinas } from "../agentes/rotinas.js";
import { montar } from "./apoio.js";

test("Central: sem login não acessa; com login roda comando e aprova operação", async () => {
  const { c, fonte } = montar();
  const srv = createServer(criarApp({ coordenador: c, rotinas: new Rotinas(c), senha: "segredo-forte" })).listen(0, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    assert.equal((await fetch(base + "/api/estado")).status, 401);
    assert.equal((await fetch(base + "/api/entrar", { method: "POST", body: JSON.stringify({ senha: "errada" }) })).status, 401);
    const login = await fetch(base + "/api/entrar", { method: "POST", body: JSON.stringify({ senha: "segredo-forte" }) });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const post = (p, b) => fetch(base + p, { method: "POST", headers: { cookie }, body: JSON.stringify(b) }).then((r) => r.json());

    const rel = await post("/api/comando", { texto: "parcelas atrasadas" });
    assert.equal(rel.resultados[0].agente, "AGENTE_07_CREDIARIO");
    assert.equal(rel.resultados[0].metricas.find((m) => m.nome === "parcelas_vencidas").valor, 1);

    const { aprovacao } = c.solicitarOperacao({ agente: "AGENTE_03_ESTOQUE", ferramenta: "registrar_entrada_estoque", input: { cod: "116860-0", qtd: 1, custoUnitario: 830 }, resumo: "entrada" });
    const r = await post("/api/aprovacao", { id: aprovacao.id, aprovar: true });
    assert.equal(r.execucao.status, "CONCLUIDA");
    assert.equal(fonte.escritas.length, 1);
    const est = await fetch(base + "/api/estado", { headers: { cookie } }).then((x) => x.json());
    assert.equal(est.agentes.length, 12);
    assert.equal(est.trilha_integra, true);
  } finally {
    srv.close();
  }
});
