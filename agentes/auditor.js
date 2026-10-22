// agentes/auditor.js — Agente 11, Auditor e Revisor.
// Confere evidências, origem dos dados, métricas, rótulos de estimativa, recomendações e permissões,
// e roda a conferência independente do agente (relê os dados e recalcula).
// O auditor aprova ou reprova TECNICAMENTE; ele nunca concede aprovação do proprietário.

const CAMPOS_RECOMENDACAO = ["acao", "dados", "origem", "data_referencia", "metodo", "resultado", "limitacoes"];
const PALAVRAS_DE_EXECUCAO = /\b(executad[oa]|alterad[oa]|registrad[oa]|enviad[oa]|exclu[ií]d[oa]|cobrad[oa])\b/i;

export const AUDITOR = { id: "AGENTE_11_AUDITOR", nome: "Auditor e Revisor" };

export async function auditar(task, acao, ctx) {
  const problemas = [];
  const r = task.result;
  if (!r || typeof r !== "object") return { aprovado: false, problemas: ["resultado vazio"] };
  if (!Array.isArray(task.evidence) || task.evidence.length === 0) problemas.push("sem evidência de execução");
  const consultas = task.evidence.filter((e) => e.ferramenta);
  if (!r.dados_insuficientes && consultas.length === 0) problemas.push("resultado com dados mas sem nenhuma consulta registrada");
  for (const e of consultas) if (!e.fonte || !e.consultado_em) problemas.push(`evidência de ${e.ferramenta} sem fonte ou data`);

  for (const x of r.metricas || []) {
    if (x.valor !== null && (typeof x.valor !== "number" || !Number.isFinite(x.valor))) problemas.push(`métrica ${x.nome} não é número`);
    if (!x.metodo) problemas.push(`métrica ${x.nome} sem método de cálculo`);
    if (!["fato", "estimativa"].includes(x.tipo)) problemas.push(`métrica ${x.nome} sem indicar se é fato ou estimativa`);
    if (/previs|projec|esperad|estimad/i.test(x.nome) && x.tipo !== "estimativa") problemas.push(`métrica ${x.nome} é projeção apresentada como fato`);
  }
  for (const [i, rec] of (r.recomendacoes || []).entries()) {
    const faltam = CAMPOS_RECOMENDACAO.filter((c) => rec[c] === undefined || rec[c] === null);
    if (faltam.length) problemas.push(`recomendação ${i + 1} sem: ${faltam.join(", ")}`);
  }
  if (r.dados_insuficientes && !(r.limitacoes || []).length) problemas.push("dados insuficientes sem dizer o que falta");

  // Afirmar que algo foi executado exige evidência de uma ferramenta de escrita (nível ≥ 2).
  const escreveu = consultas.some((e) => e.nivel >= 2);
  if (!escreveu && PALAVRAS_DE_EXECUCAO.test(r.resumo || "")) problemas.push("resumo afirma execução sem evidência de escrita");

  // Ferramentas usadas precisam estar no catálogo do agente.
  const permitidas = new Set(ctx.ferramentas.catalogo(task.agent).map((f) => f.nome));
  for (const e of consultas) if (!permitidas.has(e.ferramenta)) problemas.push(`${task.agent} usou ${e.ferramenta} sem permissão`);

  if (acao.conferir) {
    try {
      problemas.push(...(await acao.conferir(task.input, r, ctx)));
    } catch (e) {
      problemas.push("conferência independente falhou: " + e.message);
    }
  }
  return { aprovado: problemas.length === 0, problemas };
}

// Compara métricas com o mesmo nome entre agentes: valores diferentes = conflito para o coordenador.
export function conflitos(tarefas) {
  const vistos = new Map();
  const lista = [];
  for (const t of tarefas) for (const x of t.result?.metricas || []) {
    const ant = vistos.get(x.nome);
    if (ant && ant.valor !== x.valor) lista.push({ metrica: x.nome, [ant.agent]: ant.valor, [t.agent]: x.valor });
    else vistos.set(x.nome, { valor: x.valor, agent: t.agent });
  }
  return lista;
}
