// agentes/cli.js — linha de comando dos agentes (somente leitura dos dados do programa).
//
//   node --env-file-if-exists=agentes.env agentes/cli.js "analise meu estoque"
//   node --env-file-if-exists=agentes.env agentes/cli.js --rotinas      (para o Agendador de Tarefas do Windows)

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Coordenador } from "./coordenador.js";
import { Rotinas } from "./rotinas.js";
import { ArmazemArquivo } from "./nucleo/armazem.js";
import { FonteSupabase } from "./ferramentas/dados.js";
import { criarPlanejadorIA } from "./nucleo/llm.js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const armazem = new ArmazemArquivo(process.env.DADOS_AGENTES || join(RAIZ, "dados-agentes", "agentes.json"));
const c = new Coordenador({ armazem, fonte: new FonteSupabase(), planejadorIA: criarPlanejadorIA() });

const arg = process.argv.slice(2).join(" ");
const saida = arg === "--rotinas" ? await new Rotinas(c).tick() : await c.pedido(arg || "relatório geral");
console.log(JSON.stringify(saida, null, 2));
