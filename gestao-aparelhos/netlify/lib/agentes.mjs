// Núcleo multiagente: definição dos 12 agentes, coordenador, loop de ferramentas, auditor e consolidação.
// Fluxo: COORDENADOR (plano) → ESPECIALISTAS (ferramentas reais) → AUDITOR (até 2 correções) → COORDENADOR (consolida) → EXECUÇÃO (nível 1) ou APROVAÇÃO (nível 2).
import { ferramentasPara, executarFerramenta, FERRAMENTAS } from "./ferramentas.mjs";
import * as D from "./dados.mjs";
import * as T from "./tarefas.mjs";
import { salvarMemoria, buscarMemoria, listarRecentes, storeMemoria } from "./memoria.mjs";
import { store } from "./auth.mjs";

export const MODELO_PADRAO = "claude-opus-5";
const MAX_ITERACOES = 8;          // chamadas de ferramenta por agente por rodada
const MAX_RODADAS_AUDITORIA = 2;  // correções automáticas antes de subir ao coordenador

const REGRAS_GERAIS = `REGRAS INEGOCIÁVEIS:
1. Nunca invente dados de estoque, preços, vendas, custos ou fornecedores. Use SOMENTE o que as ferramentas devolverem.
2. Nunca informe lucro sem o custo calculado pelas ferramentas. Não faça contas de cabeça: peça à ferramenta.
3. Nunca declare uma tarefa executada: você só analisa e recomenda. Ferramentas de nível 2 geram PEDIDO DE APROVAÇÃO, não execução.
4. Distinga sempre projeção de resultado efetivo, e faturamento de recebimento e de lucro. Markup (sobre custo) não é margem (sobre venda).
5. Se os dados forem insuficientes, diga isso explicitamente e o que faltaria.
6. Toda recomendação importante traz: dados utilizados, origem (ferramenta e data de referência), método de cálculo, resultado, limitações e ação recomendada.
7. Responda em português do Brasil, direto, com números formatados em R$ e US$. Use listas e tabelas curtas quando ajudar.`;

export const AGENTES = {
  AGENTE_00_COORDENADOR: { nome: "Coordenador Geral", disponivel: true, modelo: MODELO_PADRAO,
    papel: "Você é o Coordenador Geral do sistema de gestão da HEROS CELL / BYL IMPORTADOS. Interpreta pedidos do proprietário, planeja, distribui tarefas aos agentes especializados, consolida resultados e pede aprovação quando necessário." },
  AGENTE_01_COMPRAS: { nome: "Gestor de Compras", disponivel: true, modelo: MODELO_PADRAO,
    papel: "Você é o Gestor de Compras. Analisa lances de leilão e oportunidades de compra: custo total de aquisição em SP, rentabilidade esperada contra a lista de preços de venda, giro histórico, estoque atual, capital parado. Sugere quantidades e lance máximo. Evita compra excessiva de modelos com cobertura alta. Compras reais exigem aprovação (use propor_compra só quando pedido)." },
  AGENTE_02_MERCADO: { nome: "Analista de Mercado", disponivel: false, motivo: "Não há fonte externa de preços autorizada nem acesso a busca web configurado. Requer lista de fontes e orçamento de consultas.",
    papel: "Você é o Analista de Mercado. Pesquisa preços e tendências em fontes autorizadas, sempre registrando fonte, data e condição do produto." },
  AGENTE_03_ESTOQUE: { nome: "Gestor de Estoque", disponivel: true, modelo: MODELO_PADRAO,
    papel: "Você é o Gestor de Estoque. Monitora entradas e saídas, detecta aparelhos parados, inconsistências e duplicidades, acompanha disponibilidade por modelo e lote, sugere reposição e liquidação de encalhados. O sistema registra lotes por modelo (não há IMEI nem bateria por unidade); diga isso quando relevante." },
  AGENTE_04_PRECIFICACAO: { nome: "Especialista em Precificação", disponivel: true, modelo: MODELO_PADRAO,
    papel: "Você é o Especialista em Precificação. Calcula preço mínimo, preço recomendado, markup, margem bruta e desconto máximo a partir do custo de importação, da lista de preços e do giro. Não existem tributos, tarifas de pagamento nem comissões cadastrados: declare isso como limitação. Alterações de preço só por propor_preco_lista (aprovação)." },
  AGENTE_05_VENDAS: { nome: "Analista de Vendas", disponivel: true, modelo: MODELO_PADRAO,
    papel: "Você é o Analista de Vendas. Mede faturamento, lucro, margem, ticket médio, modelos mais vendidos, desempenho por cliente e por período, velocidade de giro e sazonalidade quando houver dados. Sempre separe faturamento, recebimento e lucro." },
  AGENTE_06_FINANCEIRO: { nome: "Gestor Financeiro", disponivel: true, modelo: MODELO_PADRAO,
    papel: "Você é o Gestor Financeiro. Analisa receitas, custo das vendas, lucro bruto, capital de giro parado em estoque e rentabilidade por aparelho. O sistema NÃO tem despesas, contas a pagar nem tarifas: nunca apresente lucro líquido; apresente lucro bruto e declare a limitação. Projeções devem vir marcadas como projeção." },
  AGENTE_07_CREDIARIO: { nome: "Gestor de Crediário", disponivel: true, modelo: MODELO_PADRAO,
    papel: "Você é o Gestor de Crediário do BYL STORE. Usa byl_crediario para contratos, parcelas vencidas, pendentes, recebido, inadimplência, lucro esperado × realizado, e sugere ações de cobrança. Nunca altera contratos nem sugere bloqueio de aparelho sem autorização e validação contratual. Se a ferramenta indicar indisponível, informe que o Supabase do BYL não está configurado." },
  AGENTE_08_GARANTIAS: { nome: "Gestor de Garantias", disponivel: false, motivo: "O sistema não tem registro de garantias, manutenções nem defeitos. Requer módulo de garantias.",
    papel: "Você é o Gestor de Garantias. Monitora prazos, defeitos recorrentes, custos de reparo e fornecedores com alto índice de problemas." },
  AGENTE_09_PREVISAO: { nome: "Especialista em Previsão de Demanda", disponivel: true, modelo: MODELO_PADRAO,
    papel: "Você é o Especialista em Previsão de Demanda. Usa previsao_demanda e giro_por_modelo (média e desvio semanal) para estimar demanda, estoque de segurança, risco de excesso e necessidade de capital. Sempre apresente a incerteza e o tamanho da base histórica." },
  AGENTE_10_INTELIGENCIA: { nome: "Inteligência Comercial", disponivel: true, modelo: MODELO_PADRAO,
    papel: "Você é a Inteligência Comercial. Cruza estoque, giro, preços, custo e vendas para achar o que análises isoladas não mostram: estoque alto + giro baixo = promoção; giro alto + estoque baixo = compra; custo baixo + preço estável = margem; aparelho parado = revisão de preço. Cada oportunidade cita os números que a sustentam." },
  AGENTE_11_AUDITOR: { nome: "Auditor e Revisor", disponivel: true, modelo: MODELO_PADRAO,
    papel: "Você é o Auditor. Confere cálculos contra as ferramentas, verifica origem dos dados, inconsistências, regras de negócio e permissões, e detecta recomendações potencialmente prejudiciais. Você não autoriza operações do proprietário. Devolve APROVADO ou REJEITADO com justificativa objetiva." },
};
export const listaAgentes = () => Object.entries(AGENTES).map(([id, a]) => ({ id, nome: a.nome, disponivel: a.disponivel, motivo: a.motivo || null, modelo: a.modelo || null, ferramentas: a.disponivel ? ferramentasPara(id).map((f) => f.name) : [] }));

/* ---------------- contexto de execução ---------------- */
export async function criarContexto({ st = store(), memoria = storeMemoria(), agora = new Date(), fetchImpl = fetch, env } = {}) {
  const { dados, updatedAt, vazio } = await D.carregarEstado(st);
  let byl = null, bylErro = null;
  if (D.bylConfigurado(env)) { try { byl = await D.carregarBYL({ fetchImpl, env }); } catch (e) { bylErro = String(e.message || e); } }
  return { st, memoria, state: dados, stateUpdatedAt: updatedAt, stateVazio: vazio, byl, bylErro, agora, referencia: D.hojeISO(agora) };
}

/* ---------------- utilitários de LLM ---------------- */
function textoDe(resp) { return (resp.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim(); }
function parseJSON(texto) {
  const limpo = String(texto || "").replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(limpo); } catch (e) { /* tenta extrair o primeiro objeto */ }
  const m = limpo.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch (e) { /* ignore */ } }
  return null;
}
const resumir = (v, max = 1500) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s.length > max ? s.slice(0, max) + "…" : s; };

/* ---------------- loop de ferramentas de um agente ---------------- */
export async function executarAgente({ cliente, agente, instrucao, ctx, tarefa = null, onEvento = () => {}, feedback = null }) {
  const def = AGENTES[agente];
  if (!def) throw new Error("Agente desconhecido: " + agente);
  if (!def.disponivel) return { texto: `Agente ${def.nome} indisponível: ${def.motivo}`, evidencias: [], propostas: [], indisponivel: true, tokens: { entrada: 0, saida: 0 } };
  const tools = ferramentasPara(agente);
  const system = `${def.papel}\n\n${REGRAS_GERAIS}\n\nData de referência: ${ctx.referencia}. Fonte de dados: ${ctx.stateVazio ? "SISTEMA SEM DADOS (estado vazio)" : "Gestão de Aparelhos (blob state)"}${ctx.byl ? " + BYL STORE (Supabase, leitura em " + ctx.byl.lidoEm + ")" : ""}.\nUse as ferramentas para obter todo número que citar. Depois de ter os dados, responda ao pedido de forma completa.`;
  const messages = [{ role: "user", content: instrucao + (feedback ? `\n\nREVISÃO DO AUDITOR (corrija e responda de novo):\n${feedback}` : "") }];
  const evidencias = [], propostas = []; let tokens = { entrada: 0, saida: 0 }; let texto = "";
  for (let i = 0; i < MAX_ITERACOES + 1; i++) {
    const resp = await cliente.messages.create({ model: def.modelo || MODELO_PADRAO, max_tokens: 16000, system, tools, messages });
    tokens.entrada += (resp.usage && resp.usage.input_tokens) || 0; tokens.saida += (resp.usage && resp.usage.output_tokens) || 0;
    if (resp.stop_reason === "refusal") return { texto: "O modelo recusou a tarefa.", evidencias, propostas, tokens, erro: "refusal" };
    const usos = (resp.content || []).filter((b) => b.type === "tool_use");
    if (!usos.length || i === MAX_ITERACOES) { texto = textoDe(resp) || texto; break; }
    messages.push({ role: "assistant", content: resp.content });
    const results = [];
    for (const u of usos) {
      onEvento({ tipo: "ferramenta", agente, ferramenta: u.name, input: u.input });
      const r = await executarFerramenta(u.name, u.input, { ...ctx, agente, tarefa: tarefa ? tarefa.task_id : null });
      evidencias.push({ ferramenta: u.name, input: u.input, ok: r.ok, resumo: resumir(r.ok ? (r.proposta ? r.resultado : r.resultado) : r.erro, 800), em: new Date().toISOString() });
      if (r.ok && r.proposta) propostas.push(r.proposta);
      results.push({ type: "tool_result", tool_use_id: u.id, content: r.ok ? resumir(r.resultado, 60000) : "ERRO: " + r.erro, ...(r.ok ? {} : { is_error: true }) });
    }
    messages.push({ role: "user", content: results });
  }
  return { texto, evidencias, propostas, tokens };
}

/* ---------------- auditor ---------------- */
export async function revisar({ cliente, pedido, agente, resultado, ctx, onEvento = () => {} }) {
  const def = AGENTES.AGENTE_11_AUDITOR;
  const system = `${def.papel}\n\n${REGRAS_GERAIS}\n\nVocê recebe o pedido original, o agente responsável, a resposta dele e as evidências (ferramentas chamadas e retornos). Pode chamar ferramentas para conferir números. Responda SOMENTE em JSON: {"aprovado": true|false, "problemas": ["..."], "parecer": "texto curto"}. Rejeite se houver número sem evidência, conta errada, projeção apresentada como fato, lucro sem custo, ou recomendação que viole as regras.`;
  const tools = ferramentasPara("AGENTE_11_AUDITOR");
  const messages = [{ role: "user", content: `PEDIDO: ${pedido}\nAGENTE: ${agente}\nRESPOSTA DO AGENTE:\n${resultado.texto}\n\nEVIDÊNCIAS:\n${JSON.stringify(resultado.evidencias.map((e) => ({ ferramenta: e.ferramenta, input: e.input, ok: e.ok, resumo: e.resumo.slice(0, 600) })), null, 0)}` }];
  let tokens = { entrada: 0, saida: 0 };
  for (let i = 0; i < 4; i++) {
    const resp = await cliente.messages.create({ model: def.modelo || MODELO_PADRAO, max_tokens: 8000, system, tools, messages });
    tokens.entrada += (resp.usage && resp.usage.input_tokens) || 0; tokens.saida += (resp.usage && resp.usage.output_tokens) || 0;
    const usos = (resp.content || []).filter((b) => b.type === "tool_use");
    if (!usos.length || i === 3) {
      const j = parseJSON(textoDe(resp)) || { aprovado: false, problemas: ["Auditor não devolveu JSON válido."], parecer: textoDe(resp).slice(0, 500) };
      return { aprovado: !!j.aprovado, problemas: Array.isArray(j.problemas) ? j.problemas : [], parecer: String(j.parecer || ""), tokens };
    }
    messages.push({ role: "assistant", content: resp.content });
    const results = [];
    for (const u of usos) { onEvento({ tipo: "ferramenta", agente: "AGENTE_11_AUDITOR", ferramenta: u.name, input: u.input }); const r = await executarFerramenta(u.name, u.input, { ...ctx, agente: "AGENTE_11_AUDITOR" }); results.push({ type: "tool_result", tool_use_id: u.id, content: r.ok ? resumir(r.resultado, 40000) : "ERRO: " + r.erro, ...(r.ok ? {} : { is_error: true }) }); }
    messages.push({ role: "user", content: results });
  }
}

/* ---------------- planejamento do coordenador ---------------- */
async function planejar({ cliente, comando, ctx }) {
  const disponiveis = listaAgentes().filter((a) => a.disponivel && a.id !== "AGENTE_00_COORDENADOR" && a.id !== "AGENTE_11_AUDITOR");
  const indisponiveis = listaAgentes().filter((a) => !a.disponivel);
  const memo = await listarRecentes(ctx.memoria, { tipo: "regra_comercial", limite: 5 });
  const system = `${AGENTES.AGENTE_00_COORDENADOR.papel}\n\n${REGRAS_GERAIS}\n\nAgentes disponíveis:\n${disponiveis.map((a) => `- ${a.id}: ${AGENTES[a.id].papel}`).join("\n")}\n\nIndisponíveis (não selecione; se o pedido depender deles, diga o motivo):\n${indisponiveis.map((a) => `- ${a.id}: ${a.motivo}`).join("\n")}\n\nRegras comerciais registradas:\n${memo.map((m) => "- " + m.titulo + ": " + m.conteudo.slice(0, 300)).join("\n") || "(nenhuma)"}\n\nResponda SOMENTE em JSON:\n{"interpretacao":"o que o proprietário quer","agentes":[{"id":"AGENTE_XX","instrucao":"tarefa objetiva e completa para esse agente","dependeDe":[]}],"observacao":"limitações ou agentes indisponíveis envolvidos"}\nEscolha de 1 a 4 agentes. Pedidos simples: 1 agente. Dependências só quando um agente precisa do resultado do outro.`;
  const resp = await cliente.messages.create({ model: AGENTES.AGENTE_00_COORDENADOR.modelo, max_tokens: 4000, system, messages: [{ role: "user", content: comando }] });
  const plano = parseJSON(textoDe(resp));
  const tokens = { entrada: (resp.usage && resp.usage.input_tokens) || 0, saida: (resp.usage && resp.usage.output_tokens) || 0 };
  if (!plano || !Array.isArray(plano.agentes)) return { plano: { interpretacao: comando, agentes: [{ id: "AGENTE_10_INTELIGENCIA", instrucao: comando, dependeDe: [] }], observacao: "Plano padrão (coordenador não devolveu JSON)." }, tokens };
  plano.agentes = plano.agentes.filter((a) => AGENTES[a.id] && AGENTES[a.id].disponivel && a.id !== "AGENTE_11_AUDITOR").slice(0, 4);
  if (!plano.agentes.length) plano.agentes = [{ id: "AGENTE_10_INTELIGENCIA", instrucao: comando, dependeDe: [] }];
  return { plano, tokens };
}

async function consolidar({ cliente, comando, plano, resultados, ctx }) {
  const system = `${AGENTES.AGENTE_00_COORDENADOR.papel}\n\n${REGRAS_GERAIS}\n\nConsolide as respostas dos agentes em UMA resposta final ao proprietário. Resolva conflitos entre análises citando os números. Mantenha a estrutura: Resumo · Dados utilizados (origem e data de referência) · Método · Resultado · Limitações · Ação recomendada · Pedidos de aprovação (se houver). Não acrescente números que não estejam nas respostas ou evidências.`;
  const corpo = resultados.map((r) => `### ${r.agente} (${r.auditoria.aprovado ? "aprovado pelo auditor" : "REJEITADO pelo auditor: " + r.auditoria.problemas.join("; ")})\n${r.texto}`).join("\n\n");
  const resp = await cliente.messages.create({ model: AGENTES.AGENTE_00_COORDENADOR.modelo, max_tokens: 16000, system, messages: [{ role: "user", content: `PEDIDO: ${comando}\nINTERPRETAÇÃO: ${plano.interpretacao}\nOBSERVAÇÃO DO PLANO: ${plano.observacao || ""}\n\nRESPOSTAS:\n${corpo}` }] });
  return { texto: textoDe(resp), tokens: { entrada: (resp.usage && resp.usage.input_tokens) || 0, saida: (resp.usage && resp.usage.output_tokens) || 0 } };
}

/* ---------------- fluxo completo de um comando ---------------- */
export async function executarComando({ cliente, comando, st = store(), memoria = storeMemoria(), origem = "comando", onEvento = () => {}, agora = new Date(), fetchImpl = fetch, env }) {
  const stT = T.storeTarefas();
  await T.recuperarInterrompidas(stT, { agora: agora.getTime() });
  const { duplicada, tarefa: principal } = await T.criarTarefa(stT, { agente: "AGENTE_00_COORDENADOR", acao: "COMANDO", input: { comando }, origem, titulo: comando.slice(0, 120) });
  if (duplicada) { onEvento({ tipo: "duplicada", tarefa: principal.task_id }); return principal; }
  const tokens = { entrada: 0, saida: 0 }; const soma = (t) => { tokens.entrada += t.entrada || 0; tokens.saida += t.saida || 0; };
  const emitir = (ev) => onEvento({ tarefa: principal.task_id, ...ev });
  try {
    await T.transitar(stT, principal, "EM_EXECUCAO");
    emitir({ tipo: "estado", status: "EM_EXECUCAO", msg: "Coordenador interpretando o pedido" });
    const ctx = await criarContexto({ st, memoria, agora, fetchImpl, env });
    if (ctx.bylErro) emitir({ tipo: "aviso", msg: "BYL (Supabase) não lido: " + ctx.bylErro });
    const { plano, tokens: tp } = await planejar({ cliente, comando, ctx }); soma(tp);
    await T.registrarLog(stT, principal, "plano", plano);
    emitir({ tipo: "plano", plano });

    // subtarefas por agente, respeitando dependências (independentes rodam em paralelo)
    const subs = new Map();
    for (const a of plano.agentes) {
      const { tarefa } = await T.criarTarefa(stT, { agente: a.id, acao: "ANALISAR", input: { instrucao: a.instrucao }, origem, pai: principal.task_id, janelaDedupeMs: 0, titulo: a.instrucao.slice(0, 120) });
      principal.subtarefas.push(tarefa.task_id); subs.set(a.id, { tarefa, def: a });
    }
    await T.salvarTarefa(stT, principal);
    const resultados = []; const concluidos = new Set();
    const rodar = async (a) => {
      const { tarefa } = subs.get(a.id);
      await T.transitar(stT, tarefa, "EM_EXECUCAO");
      emitir({ tipo: "agente", agente: a.id, status: "EM_EXECUCAO", msg: AGENTES[a.id].nome + " trabalhando" });
      const contexto = (a.dependeDe || []).map((d) => { const r = resultados.find((x) => x.agente === d); return r ? `RESULTADO DE ${d}:\n${r.texto}` : ""; }).filter(Boolean).join("\n\n");
      let instrucao = a.instrucao + (contexto ? "\n\nCONTEXTO DE OUTROS AGENTES:\n" + contexto : "");
      let res = await executarAgente({ cliente, agente: a.id, instrucao, ctx, tarefa, onEvento: emitir }); soma(res.tokens);
      let auditoria = { aprovado: true, problemas: [], parecer: "sem auditoria" };
      for (let rodada = 0; rodada <= MAX_RODADAS_AUDITORIA; rodada++) {
        await T.transitar(stT, tarefa, "AGUARDANDO_REVISAO", { result: { texto: res.texto }, evidence: res.evidencias });
        emitir({ tipo: "agente", agente: a.id, status: "AGUARDANDO_REVISAO", msg: "Auditor revisando " + AGENTES[a.id].nome });
        auditoria = await revisar({ cliente, pedido: a.instrucao, agente: a.id, resultado: res, ctx, onEvento: emitir }); soma(auditoria.tokens);
        await T.registrarLog(stT, tarefa, "auditoria rodada " + (rodada + 1), auditoria);
        if (auditoria.aprovado || rodada === MAX_RODADAS_AUDITORIA) break;
        emitir({ tipo: "agente", agente: a.id, status: "CORRIGINDO", msg: "Auditor devolveu: " + auditoria.problemas.join("; ") });
        await T.transitar(stT, tarefa, "EM_EXECUCAO");
        res = await executarAgente({ cliente, agente: a.id, instrucao, ctx, tarefa, onEvento: emitir, feedback: auditoria.problemas.join("\n") + "\n" + auditoria.parecer }); soma(res.tokens);
      }
      for (const p of res.propostas) {
        const { tarefa: tp2 } = await T.criarTarefa(stT, { agente: a.id, acao: "PROPOSTA_" + String(p.tipo).toUpperCase(), input: p, origem, pai: principal.task_id, requer_aprovacao: true, janelaDedupeMs: 0, titulo: (p.tipo === "compra" ? "Registrar compra " + p.nome : "Alterar preço " + p.modelo + " → R$ " + p.preco) });
        await T.transitar(stT, tp2, "EM_EXECUCAO"); await T.transitar(stT, tp2, "AGUARDANDO_APROVACAO", { proposta: p, evidence: res.evidencias.slice(-5) });
        principal.subtarefas.push(tp2.task_id);
        emitir({ tipo: "aprovacao", tarefa: tp2.task_id, proposta: p });
      }
      await T.transitar(stT, tarefa, auditoria.aprovado ? "CONCLUIDA" : "FALHOU", { result: { texto: res.texto, auditoria }, evidence: res.evidencias, error: auditoria.aprovado ? null : { codigo: "REPROVADO_AUDITOR", mensagem: auditoria.problemas.join("; ") } });
      emitir({ tipo: "agente", agente: a.id, status: auditoria.aprovado ? "CONCLUIDA" : "FALHOU", msg: AGENTES[a.id].nome + (auditoria.aprovado ? " concluído" : " reprovado pelo auditor") });
      resultados.push({ agente: a.id, texto: res.texto, evidencias: res.evidencias, auditoria, propostas: res.propostas });
      concluidos.add(a.id);
    };
    let pendentes = [...plano.agentes];
    while (pendentes.length) {
      const prontos = pendentes.filter((a) => (a.dependeDe || []).every((d) => concluidos.has(d) || !pendentes.find((x) => x.id === d)));
      if (!prontos.length) throw new Error("Dependência circular no plano.");
      await Promise.all(prontos.map(rodar));
      pendentes = pendentes.filter((a) => !concluidos.has(a.id));
    }
    emitir({ tipo: "estado", status: "CONSOLIDANDO", msg: "Coordenador consolidando" });
    const fim = await consolidar({ cliente, comando, plano, resultados, ctx }); soma(fim.tokens);
    const propostas = resultados.flatMap((r) => r.propostas);
    await salvarMemoria(memoria, { titulo: (origem === "rotina" ? "Rotina: " : "Comando: ") + comando.slice(0, 80), conteudo: fim.texto, tipo: origem === "rotina" ? "relatorio" : "analise", agente: "AGENTE_00_COORDENADOR", tarefa: principal.task_id, palavras: plano.agentes.map((a) => a.id) });
    await T.transitar(stT, principal, propostas.length ? "AGUARDANDO_APROVACAO" : "CONCLUIDA", { result: { texto: fim.texto, interpretacao: plano.interpretacao, agentes: resultados.map((r) => ({ agente: r.agente, aprovado: r.auditoria.aprovado, parecer: r.auditoria.parecer })), propostas, tokens } });
    emitir({ tipo: "concluida", status: principal.status, resultado: principal.result });
    return principal;
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    await salvarMemoria(memoria, { titulo: "Erro em " + principal.task_id, conteudo: msg, tipo: "erro", agente: "AGENTE_00_COORDENADOR", tarefa: principal.task_id, palavras: ["erro"] }).catch(() => {});
    if (principal.status === "EM_EXECUCAO" || principal.status === "PENDENTE") await T.transitar(stT, principal, "FALHOU", { error: { codigo: "EXCECAO", mensagem: msg } }).catch(() => {});
    emitir({ tipo: "erro", msg });
    return principal;
  }
}

/* ---------------- aprovação pelo proprietário ---------------- */
export async function decidirProposta({ task_id, decisao, motivo = "", st = store(), memoria = storeMemoria() }) {
  const stT = T.storeTarefas();
  const t = await T.obterTarefa(stT, task_id);
  if (!t) throw new Error("Tarefa não encontrada.");
  if (t.status !== "AGUARDANDO_APROVACAO") throw new Error("Tarefa não está aguardando aprovação (estado " + t.status + ").");
  const { executarProposta } = await import("./ferramentas.mjs");
  if (decisao === "rejeitar") {
    await T.transitar(stT, t, "CANCELADA", { aprovacao: { decisao, motivo, em: new Date().toISOString() } });
    await salvarMemoria(memoria, { titulo: "Proposta rejeitada: " + t.titulo, conteudo: motivo || "sem motivo informado", tipo: "decisao", agente: t.agente, tarefa: t.task_id, palavras: ["rejeitada"] });
    return t;
  }
  if (decisao !== "aprovar") throw new Error("Decisão inválida.");
  await T.transitar(stT, t, "EM_EXECUCAO", { aprovacao: { decisao, motivo, em: new Date().toISOString() } });
  try {
    const r = await executarProposta(st, t.proposta);
    await T.transitar(stT, t, "CONCLUIDA", { result: r, evidence: [...(t.evidence || []), { ferramenta: "executarProposta", ok: true, resumo: r.descricao, em: new Date().toISOString() }] });
    await salvarMemoria(memoria, { titulo: "Executado após aprovação: " + t.titulo, conteudo: r.descricao, tipo: "alteracao", agente: t.agente, tarefa: t.task_id, palavras: ["aprovada", t.proposta.tipo] });
  } catch (e) {
    await T.transitar(stT, t, "FALHOU", { error: { codigo: "EXECUCAO", mensagem: String(e.message || e) } });
    throw e;
  }
  return t;
}

/* ---------------- rotinas agendadas ---------------- */
export const ROTINAS = {
  diaria: { nome: "Relatório diário", comando: "Rotina diária: verifique inconsistências, aparelhos parados há mais de 30 dias, resumo de vendas e lucro dos últimos 7 dias, estoque e capital parado, e parcelas vencidas do crediário do BYL se disponível. Produza um relatório gerencial curto com alertas." },
  semanal: { nome: "Análise semanal", comando: "Rotina semanal: analise giro de estoque dos últimos 90 dias, rentabilidade por modelo, cobertura de estoque, sugestões de reposição e de liquidação, e oportunidades comerciais cruzando estoque, giro e preços. Produza recomendações com números." },
  mensal: { nome: "Consolidação mensal", comando: "Rotina mensal: consolide o mês anterior (faturamento, custo das vendas, lucro bruto, margem, ticket médio, por cliente e por modelo), compare com o mês anterior a ele, avalie o crediário do BYL se disponível e produza um relatório executivo com limitações declaradas." },
};
export async function lerConfigRotinas() { const stT = T.storeTarefas(); return (await stT.get("config", { type: "json" })) || { diaria: true, semanal: true, mensal: true }; }
export async function gravarConfigRotinas(cfg) { const stT = T.storeTarefas(); await stT.setJSON("config", cfg); return cfg; }
export async function executarRotina(nome, { cliente, forcar = false, onEvento = () => {} } = {}) {
  const r = ROTINAS[nome]; if (!r) throw new Error("Rotina desconhecida: " + nome);
  const cfg = await lerConfigRotinas();
  if (!forcar && cfg[nome] === false) return { pulada: true, motivo: "rotina desativada" };
  return executarComando({ cliente, comando: r.comando, origem: "rotina", onEvento });
}
