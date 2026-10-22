// Fila de tarefas persistente (Netlify Blobs, store "agentes").
// Estados obrigatórios e transições permitidas. Nada some em silêncio.
import { getStore } from "@netlify/blobs";

export const ESTADOS = ["PENDENTE", "EM_EXECUCAO", "AGUARDANDO_REVISAO", "AGUARDANDO_APROVACAO", "CONCLUIDA", "FALHOU", "CANCELADA"];
export const TRANSICOES = {
  PENDENTE: ["EM_EXECUCAO", "CANCELADA", "FALHOU"],
  EM_EXECUCAO: ["AGUARDANDO_REVISAO", "AGUARDANDO_APROVACAO", "CONCLUIDA", "FALHOU", "PENDENTE", "CANCELADA"],
  AGUARDANDO_REVISAO: ["EM_EXECUCAO", "CONCLUIDA", "FALHOU", "CANCELADA"],
  AGUARDANDO_APROVACAO: ["EM_EXECUCAO", "CONCLUIDA", "CANCELADA", "FALHOU"],
  CONCLUIDA: [], FALHOU: ["PENDENTE"], CANCELADA: [],
};
const ATIVOS = new Set(["PENDENTE", "EM_EXECUCAO", "AGUARDANDO_REVISAO", "AGUARDANDO_APROVACAO"]);
const INDICE = "indice"; const CONTADOR = "contador"; const MAX_INDICE = 500;

export const storeTarefas = () => getStore({ name: "agentes", consistency: "strong" });

export function hashTarefa(agente, acao, input) {
  const s = JSON.stringify([agente, acao, input]);
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

async function proximoId(st) {
  const c = (await st.get(CONTADOR, { type: "json" })) || { n: 0 };
  c.n += 1; await st.setJSON(CONTADOR, c);
  return "TASK-" + String(c.n).padStart(4, "0");
}
async function lerIndice(st) { return (await st.get(INDICE, { type: "json" })) || { ids: [] }; }
async function indexar(st, id) {
  const idx = await lerIndice(st);
  if (!idx.ids.includes(id)) idx.ids.unshift(id);
  if (idx.ids.length > MAX_INDICE) idx.ids = idx.ids.slice(0, MAX_INDICE);
  await st.setJSON(INDICE, idx);
}

export async function criarTarefa(st, { agente, acao, input = {}, origem = "comando", pai = null, requer_aprovacao = false, dependencias = [], maxTentativas = 2, janelaDedupeMs = 10 * 60 * 1000, titulo = "" }) {
  const hash = hashTarefa(agente, acao, input);
  const dup = await encontrarDuplicada(st, hash, janelaDedupeMs);
  if (dup) return { duplicada: true, tarefa: dup };
  const id = await proximoId(st);
  const agora = new Date().toISOString();
  const t = { task_id: id, titulo, agente, action: acao, input, origem, pai, status: "PENDENTE", requires_approval: !!requer_aprovacao, result: null, evidence: [], error: null,
    tentativas: 0, maxTentativas, dependencias, hash, criadaEm: agora, atualizadaEm: agora, iniciadaEm: null, concluidaEm: null, proposta: null, aprovacao: null, log: [{ t: agora, msg: "criada" }], subtarefas: [] };
  await st.setJSON("tarefa/" + id, t);
  await indexar(st, id);
  return { duplicada: false, tarefa: t };
}
export async function obterTarefa(st, id) { return st.get("tarefa/" + id, { type: "json" }); }
export async function salvarTarefa(st, t) { t.atualizadaEm = new Date().toISOString(); await st.setJSON("tarefa/" + t.task_id, t); return t; }
export async function registrarLog(st, t, msg, extra) {
  t.log.push({ t: new Date().toISOString(), msg, ...(extra ? { extra } : {}) });
  if (t.log.length > 200) t.log = t.log.slice(-200);
  return salvarTarefa(st, t);
}
export async function transitar(st, t, novo, extra = {}) {
  if (!ESTADOS.includes(novo)) throw new Error("Estado inválido: " + novo);
  if (!TRANSICOES[t.status].includes(novo)) throw new Error(`Transição não permitida: ${t.status} → ${novo} (${t.task_id})`);
  const antes = t.status; t.status = novo;
  if (novo === "EM_EXECUCAO") { t.iniciadaEm = new Date().toISOString(); t.tentativas += 1; }
  if (novo === "CONCLUIDA" || novo === "FALHOU" || novo === "CANCELADA") t.concluidaEm = new Date().toISOString();
  Object.assign(t, extra);
  t.log.push({ t: new Date().toISOString(), msg: `${antes} → ${novo}` });
  return salvarTarefa(st, t);
}
export async function listarTarefas(st, { status, limite = 50 } = {}) {
  const idx = await lerIndice(st);
  const out = [];
  for (const id of idx.ids) {
    if (out.length >= limite) break;
    const t = await obterTarefa(st, id);
    if (t && (!status || t.status === status)) out.push(t);
  }
  return out;
}
export async function encontrarDuplicada(st, hash, janelaMs) {
  const idx = await lerIndice(st);
  const limite = Date.now() - janelaMs;
  for (const id of idx.ids.slice(0, 50)) {
    const t = await obterTarefa(st, id);
    if (!t) continue;
    if (new Date(t.criadaEm).getTime() < limite) break;
    if (t.hash === hash && ATIVOS.has(t.status)) return t;
  }
  return null;
}
// Tarefas EM_EXECUCAO há mais tempo que o limite: voltam para PENDENTE se ainda têm tentativas, senão FALHOU.
export async function recuperarInterrompidas(st, { limiteMs = 15 * 60 * 1000, agora = Date.now() } = {}) {
  const idx = await lerIndice(st); const alteradas = [];
  for (const id of idx.ids.slice(0, 100)) {
    const t = await obterTarefa(st, id);
    if (!t || t.status !== "EM_EXECUCAO") continue;
    const inicio = new Date(t.iniciadaEm || t.atualizadaEm).getTime();
    if (agora - inicio < limiteMs) continue;
    if (t.tentativas < t.maxTentativas) await transitar(st, t, "PENDENTE", { error: { codigo: "INTERROMPIDA", mensagem: "Execução interrompida; reagendada." } });
    else await transitar(st, t, "FALHOU", { error: { codigo: "INTERROMPIDA", mensagem: "Execução interrompida após " + t.tentativas + " tentativa(s)." } });
    alteradas.push(t);
  }
  return alteradas;
}
export async function dependenciasConcluidas(st, t) {
  for (const id of t.dependencias || []) { const d = await obterTarefa(st, id); if (!d || d.status !== "CONCLUIDA") return false; }
  return true;
}
