// agentes/servidor.js — roda a camada de agentes no PC (local), sem bibliotecas externas.
//
//   node --env-file-if-exists=agentes.env agentes/servidor.js
//
// Abre a CENTRAL DE INTELIGÊNCIA em http://127.0.0.1:8787 . Por padrão só aceita conexões do próprio PC;
// HOST=0.0.0.0 libera para a rede local (celular no mesmo Wi-Fi).
// Variáveis (agentes.env, nunca no código): SUPABASE_URL, SUPABASE_KEY, ADMIN_SENHA,
// ANTHROPIC_API_KEY (opcional), DADOS_AGENTES (arquivo da memória/fila), PORTA, HOST.

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Coordenador } from "./coordenador.js";
import { Rotinas } from "./rotinas.js";
import { ArmazemArquivo } from "./nucleo/armazem.js";
import { FonteSupabase } from "./ferramentas/dados.js";
import { criarPlanejadorIA } from "./nucleo/llm.js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

export function criarApp({ coordenador, rotinas, senha, usuario = "proprietario" }) {
  const sessoes = new Map();
  const ESPERA = 12 * 3600_000;
  const pagina = () => readFileSync(join(RAIZ, "central.html"));

  const ator = (req) => {
    const tok = /(?:^|;\s*)sessao=([a-f0-9]{48})/.exec(req.headers.cookie || "")?.[1];
    const s = tok && sessoes.get(tok);
    if (!s || s.expira < Date.now()) return null;
    return { tipo: "humano", usuario: s.usuario, papel: "proprietario", autenticado: true };
  };
  const confere = (dada) => {
    if (!senha || typeof dada !== "string") return false;
    const a = Buffer.from(dada), b = Buffer.from(senha);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const json = (res, status, corpo, extra = {}) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra });
    res.end(JSON.stringify(corpo));
  };
  const corpo = (req) => new Promise((ok, erro) => {
    let s = "";
    req.on("data", (c) => { s += c; if (s.length > 64_000) erro(new Error("corpo grande demais")); });
    req.on("end", () => { try { ok(s ? JSON.parse(s) : {}); } catch { erro(new Error("JSON inválido")); } });
  });

  return async (req, res) => {
    const url = new URL(req.url, "http://local");
    try {
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/central")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(pagina());
      }
      if (req.method === "POST" && url.pathname === "/api/entrar") {
        const b = await corpo(req);
        if (!confere(b.senha)) return json(res, 401, { erro: senha ? "senha incorreta" : "defina ADMIN_SENHA no agentes.env" });
        const tok = randomBytes(24).toString("hex");
        sessoes.set(tok, { usuario, expira: Date.now() + ESPERA });
        coordenador.auditoria.registrar({ ator: usuario, acao: "LOGIN" });
        return json(res, 200, { ok: true }, { "set-cookie": `sessao=${tok}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ESPERA / 1000}` });
      }
      const quem = ator(req);
      if (url.pathname.startsWith("/api/") && !quem) return json(res, 401, { erro: "faça login" });

      if (req.method === "GET" && url.pathname === "/api/estado") return json(res, 200, { ...coordenador.estado(), rotinas: rotinas.listar() });
      if (req.method === "POST" && url.pathname === "/api/comando") {
        const { texto } = await corpo(req);
        if (!texto || typeof texto !== "string") return json(res, 400, { erro: "envie o texto do pedido" });
        return json(res, 200, await coordenador.pedido(texto.slice(0, 500), { solicitante: quem.usuario }));
      }
      if (req.method === "POST" && url.pathname === "/api/aprovacao") {
        const { id, aprovar, confirmacao, motivo } = await corpo(req);
        const ap = coordenador.aprovacoes.decidir(id, quem, { aprovar: !!aprovar, confirmacao, motivo });
        const execucao = ap.status === "APROVADA" ? await coordenador.executarAprovada(ap.task_id, ap.id) : null;
        return json(res, 200, { aprovacao: ap, execucao });
      }
      if (req.method === "POST" && url.pathname === "/api/rotina") {
        const { nome, acao, mudancas } = await corpo(req);
        if (acao === "executar") return json(res, 200, await rotinas.executar(nome));
        if (acao === "ativar") return json(res, 200, rotinas.ativar(nome));
        if (acao === "desativar") return json(res, 200, rotinas.desativar(nome));
        if (acao === "configurar") return json(res, 200, rotinas.configurar(nome, mudancas || {}));
        return json(res, 400, { erro: "ação de rotina inválida" });
      }
      if (req.method === "GET" && url.pathname === "/api/rotina") return json(res, 200, rotinas.resultados(url.searchParams.get("nome"), 10));
      if (req.method === "GET" && url.pathname === "/api/tarefa") return json(res, 200, coordenador.fila.obter(url.searchParams.get("id")));
      if (req.method === "GET" && url.pathname === "/api/memoria") return json(res, 200, coordenador.memoria.buscar({ texto: url.searchParams.get("q") || "", limite: 20 }));
      json(res, 404, { erro: "não encontrado" });
    } catch (e) {
      json(res, 400, { erro: e.message });
    }
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const armazem = new ArmazemArquivo(process.env.DADOS_AGENTES || join(RAIZ, "dados-agentes", "agentes.json"));
  const coordenador = new Coordenador({ armazem, fonte: new FonteSupabase(), planejadorIA: criarPlanejadorIA() });
  const rotinas = new Rotinas(coordenador);
  const app = criarApp({ coordenador, rotinas, senha: process.env.ADMIN_SENHA });
  const porta = Number(process.env.PORTA || 8787);
  const host = process.env.HOST || "127.0.0.1";
  createServer(app).listen(porta, host, () => {
    console.log(`Central de Inteligência: http://${host === "0.0.0.0" ? "localhost" : host}:${porta}`);
    console.log(`IA: ${process.env.ANTHROPIC_API_KEY ? "ligada" : "desligada (roteador por regras)"}`);
  });
  // Rotinas: confere a cada minuto enquanto o servidor estiver aberto.
  const tick = () => rotinas.tick().catch((e) => coordenador.auditoria.registrar({ ator: "ROTINAS", acao: "ROTINA_FALHOU", detalhes: { erro: e.message } }));
  tick();
  setInterval(tick, 60_000);
}
