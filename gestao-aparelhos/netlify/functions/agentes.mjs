// Central de Inteligência — API dos agentes.
// GET  /api/agentes/status            agentes, disponibilidade, configuração
// POST /api/agentes/comando           { comando } → stream SSE com progresso e resultado
// GET  /api/agentes/tarefas?status=   lista de tarefas (mais recentes primeiro)
// GET  /api/agentes/tarefa?id=        uma tarefa com log e evidências
// POST /api/agentes/aprovar           { task_id, decisao: "aprovar"|"rejeitar", motivo }
// GET  /api/agentes/memoria?q=&tipo=  busca na memória
// GET/POST /api/agentes/rotinas       configuração (ativar/desativar) e execução sob demanda { executar: "diaria" }
// Todas exigem a senha do proprietário (header x-sync-key).
import { json, store, senhaConfere } from "../lib/auth.mjs";
import { listaAgentes, executarComando, decidirProposta, ROTINAS, lerConfigRotinas, gravarConfigRotinas, executarRotina } from "../lib/agentes.mjs";
import { listarTarefas, obterTarefa, storeTarefas, recuperarInterrompidas } from "../lib/tarefas.mjs";
import { buscarMemoria, listarRecentes, storeMemoria } from "../lib/memoria.mjs";
import { bylConfigurado } from "../lib/dados.mjs";
import { clienteIA, temIA as iaConfigurada, ERRO_SEM_CHAVE } from "../lib/ia.mjs";

export const config = { path: ["/api/agentes/status", "/api/agentes/comando", "/api/agentes/tarefas", "/api/agentes/tarefa", "/api/agentes/aprovar", "/api/agentes/memoria", "/api/agentes/rotinas"] };

const cliente = () => clienteIA();

export default async (req) => {
  const url = new URL(req.url);
  const rota = url.pathname.replace(/^\/api\/agentes\//, "");
  const st = store();
  if (!(await senhaConfere(st, req.headers.get("x-sync-key") || ""))) return json({ error: "Senha de acesso inválida." }, 401);
  const temIA = iaConfigurada();

  if (rota === "status" && req.method === "GET") {
    const stT = storeTarefas();
    const recuperadas = await recuperarInterrompidas(stT);
    const aguardando = await listarTarefas(stT, { status: "AGUARDANDO_APROVACAO", limite: 20 });
    const alertas = await listarRecentes(storeMemoria(), { tipo: "alerta", limite: 10 });
    const recomendacoes = await listarRecentes(storeMemoria(), { tipo: "recomendacao", limite: 10 });
    return json({ agentes: listaAgentes(), ia: temIA, byl: bylConfigurado(), rotinas: { config: await lerConfigRotinas(), disponiveis: Object.entries(ROTINAS).map(([k, r]) => ({ id: k, nome: r.nome })) }, aguardandoAprovacao: aguardando.length, recuperadas: recuperadas.length, alertas, recomendacoes });
  }

  if (rota === "comando" && req.method === "POST") {
    if (!temIA) return json({ error: ERRO_SEM_CHAVE }, 503);
    let body; try { body = await req.json(); } catch (e) { return json({ error: "JSON inválido." }, 400); }
    const comando = String(body && body.comando || "").trim();
    if (!comando) return json({ error: "Informe o comando." }, 400);
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(ctrl) {
        const send = (ev) => { try { ctrl.enqueue(enc.encode("data: " + JSON.stringify(ev) + "\n\n")); } catch (e) { /* stream fechado */ } };
        const ping = setInterval(() => send({ tipo: "ping", t: Date.now() }), 15000);
        try {
          const t = await executarComando({ cliente: cliente(), comando, st, onEvento: send });
          send({ tipo: "fim", tarefa: { task_id: t.task_id, status: t.status, result: t.result, error: t.error, subtarefas: t.subtarefas } });
        } catch (e) { send({ tipo: "erro", msg: String(e && e.message ? e.message : e) }); }
        finally { clearInterval(ping); try { ctrl.close(); } catch (e) { /* ignore */ } }
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
  }

  if (rota === "tarefas" && req.method === "GET") {
    const status = url.searchParams.get("status") || undefined; const limite = Math.min(200, Number(url.searchParams.get("limite")) || 50);
    const lista = await listarTarefas(storeTarefas(), { status, limite });
    return json(lista.map((t) => ({ task_id: t.task_id, titulo: t.titulo, agente: t.agente, action: t.action, status: t.status, origem: t.origem, pai: t.pai, requires_approval: t.requires_approval, criadaEm: t.criadaEm, atualizadaEm: t.atualizadaEm, tentativas: t.tentativas, error: t.error, proposta: t.proposta, resumo: t.result && t.result.texto ? String(t.result.texto).slice(0, 300) : (t.result && t.result.descricao) || null, subtarefas: t.subtarefas })));
  }
  if (rota === "tarefa" && req.method === "GET") {
    const t = await obterTarefa(storeTarefas(), url.searchParams.get("id") || "");
    return t ? json(t) : json({ error: "Tarefa não encontrada." }, 404);
  }
  if (rota === "aprovar" && req.method === "POST") {
    let body; try { body = await req.json(); } catch (e) { return json({ error: "JSON inválido." }, 400); }
    try { const t = await decidirProposta({ task_id: body.task_id, decisao: body.decisao, motivo: body.motivo || "", st }); return json({ ok: true, status: t.status, result: t.result }); }
    catch (e) { return json({ error: String(e.message || e) }, 400); }
  }
  if (rota === "memoria" && req.method === "GET") {
    const q = url.searchParams.get("q") || ""; const tipo = url.searchParams.get("tipo") || undefined; const agente = url.searchParams.get("agente") || undefined;
    const docs = q ? await buscarMemoria(storeMemoria(), { consulta: q, tipo, agente, limite: 20 }) : await listarRecentes(storeMemoria(), { tipo, agente, limite: 30 });
    return json(docs);
  }
  if (rota === "rotinas") {
    if (req.method === "GET") return json({ config: await lerConfigRotinas(), rotinas: Object.entries(ROTINAS).map(([k, r]) => ({ id: k, nome: r.nome, comando: r.comando })) });
    let body; try { body = await req.json(); } catch (e) { return json({ error: "JSON inválido." }, 400); }
    if (body && body.config) return json({ config: await gravarConfigRotinas({ diaria: !!body.config.diaria, semanal: !!body.config.semanal, mensal: !!body.config.mensal }) });
    if (body && body.executar) {
      if (!temIA) return json({ error: ERRO_SEM_CHAVE }, 503);
      const enc = new TextEncoder();
      const stream = new ReadableStream({ async start(ctrl) { const send = (ev) => { try { ctrl.enqueue(enc.encode("data: " + JSON.stringify(ev) + "\n\n")); } catch (e) { /* ignore */ } }; try { const r = await executarRotina(body.executar, { cliente: cliente(), forcar: true, onEvento: send }); send({ tipo: "fim", tarefa: r.pulada ? r : { task_id: r.task_id, status: r.status, result: r.result } }); } catch (e) { send({ tipo: "erro", msg: String(e.message || e) }); } finally { try { ctrl.close(); } catch (e) { /* ignore */ } } } });
      return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" } });
    }
    return json({ error: "Corpo inválido." }, 400);
  }
  return json({ error: "Rota ou método não permitido." }, 405);
};
