import { test } from "node:test";
import assert from "node:assert/strict";
import { salvarMemoria, buscarMemoria, listarRecentes, tokens } from "../netlify/lib/memoria.mjs";
import { getStore } from "./mocks/blobs.mjs";
import { resetStores } from "./helpers.mjs";

test("tokeniza sem acentos e sem stopwords", () => {
  assert.deepEqual(tokens("Análise do iPhone 13 parado há 40 dias"), ["analise", "iphone", "13", "parado", "40", "dias"]);
});
test("salva, indexa e busca por palavra, agente, tipo e aparelho", async () => {
  resetStores(); const st = getStore({ name: "memoria" });
  await salvarMemoria(st, { titulo: "iPhone 13 128GB parado", conteudo: "3 unidades há 51 dias", tipo: "alerta", agente: "AGENTE_03_ESTOQUE", aparelho: "iPhone 13 128GB", palavras: ["estoque"] });
  await salvarMemoria(st, { titulo: "Regra de margem mínima", conteudo: "nunca abaixo de 10% sobre a venda", tipo: "regra_comercial", agente: "AGENTE_00_COORDENADOR", palavras: ["margem"] });
  const r1 = await buscarMemoria(st, { consulta: "aparelho parado estoque" });
  assert.equal(r1.length, 1); assert.equal(r1[0].tipo, "alerta");
  const r2 = await buscarMemoria(st, { consulta: "margem", tipo: "regra_comercial" });
  assert.equal(r2.length, 1);
  const r3 = await buscarMemoria(st, { aparelho: "iphone 13" });
  assert.equal(r3.length, 1);
  const outra = getStore({ name: "memoria" });
  assert.equal((await listarRecentes(outra)).length, 2);
  await assert.rejects(() => salvarMemoria(st, { titulo: "x", conteudo: "y", tipo: "invalido" }));
});
