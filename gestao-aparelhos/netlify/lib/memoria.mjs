// Memória persistente dos agentes (Netlify Blobs, store "memoria").
// Guarda análises, decisões, erros e procedimentos. NÃO guarda transações: o blob "state" e o Supabase são a fonte oficial.
import { getStore } from "@netlify/blobs";

export const TIPOS = ["arquitetura", "regra_comercial", "decisao", "analise", "fornecedor", "erro", "procedimento", "alteracao", "teste", "relatorio", "alerta", "recomendacao"];
const INDICE = "indice"; const MAX_DOCS = 5000;
export const storeMemoria = () => getStore({ name: "memoria", consistency: "strong" });

const STOP = new Set("a o os as um uma uns umas de do da dos das em no na nos nas e ou que com por para pra se não sim ao à às é são foi ser ter tem há mais menos muito pouco como qual quais este esta esse essa isso isto aquele aquela ele ela eles elas seu sua seus suas meu minha nosso nossa já até sobre entre sem ha nao ja ate sao voce the of and".split(" "));
export function tokens(texto) {
  return String(texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !STOP.has(w));
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

async function lerIndice(st) { return (await st.get(INDICE, { type: "json" })) || { docs: {} }; }

export async function salvarMemoria(st, { titulo, conteudo, tipo = "analise", agente = "AGENTE_00_COORDENADOR", tarefa = null, aparelho = null, palavras = [], data = null }) {
  if (!titulo || !conteudo) throw new Error("Memória precisa de título e conteúdo.");
  if (!TIPOS.includes(tipo)) throw new Error("Tipo de memória inválido: " + tipo);
  const id = "mem-" + uid();
  const doc = { id, titulo, conteudo: typeof conteudo === "string" ? conteudo : JSON.stringify(conteudo), tipo, agente, tarefa, aparelho, data: data || new Date().toISOString().slice(0, 10), criadoEm: new Date().toISOString(),
    palavras: [...new Set([...palavras.map((p) => String(p).toLowerCase()), ...tokens(titulo), ...(aparelho ? tokens(aparelho) : [])])] };
  await st.setJSON("doc/" + id, doc);
  const idx = await lerIndice(st);
  idx.docs[id] = { titulo, tipo, agente, tarefa, aparelho, data: doc.data, criadoEm: doc.criadoEm, palavras: doc.palavras };
  const ids = Object.keys(idx.docs);
  if (ids.length > MAX_DOCS) { ids.sort((a, b) => idx.docs[a].criadoEm.localeCompare(idx.docs[b].criadoEm)); for (const old of ids.slice(0, ids.length - MAX_DOCS)) { delete idx.docs[old]; await st.delete("doc/" + old); } }
  await st.setJSON(INDICE, idx);
  return doc;
}
export async function obterMemoria(st, id) { return st.get("doc/" + id, { type: "json" }); }

// Busca por palavras-chave com filtros. Carrega o conteúdo só dos resultados.
export async function buscarMemoria(st, { consulta = "", agente, tipo, aparelho, tarefa, de, ate, limite = 8 } = {}) {
  const idx = await lerIndice(st);
  const q = tokens(consulta);
  const scored = [];
  for (const [id, m] of Object.entries(idx.docs)) {
    if (agente && m.agente !== agente) continue;
    if (tipo && m.tipo !== tipo) continue;
    if (tarefa && m.tarefa !== tarefa) continue;
    if (aparelho && !(m.aparelho && m.aparelho.toLowerCase().includes(String(aparelho).toLowerCase()))) continue;
    if (de && m.data < de) continue;
    if (ate && m.data > ate) continue;
    let score = 0;
    if (q.length) { const set = new Set(m.palavras); q.forEach((w) => { if (set.has(w)) score += 2; else if (m.palavras.some((p) => p.startsWith(w) || w.startsWith(p))) score += 1; }); if (!score) continue; }
    scored.push({ id, score, criadoEm: m.criadoEm });
  }
  scored.sort((a, b) => b.score - a.score || b.criadoEm.localeCompare(a.criadoEm));
  const out = [];
  for (const s of scored.slice(0, limite)) { const d = await obterMemoria(st, s.id); if (d) out.push({ ...d, score: s.score }); }
  return out;
}
export async function listarRecentes(st, { tipo, agente, limite = 20 } = {}) {
  const idx = await lerIndice(st);
  const ids = Object.entries(idx.docs).filter(([, m]) => (!tipo || m.tipo === tipo) && (!agente || m.agente === agente)).sort((a, b) => b[1].criadoEm.localeCompare(a[1].criadoEm)).slice(0, limite).map(([id]) => id);
  const out = []; for (const id of ids) { const d = await obterMemoria(st, id); if (d) out.push(d); }
  return out;
}
