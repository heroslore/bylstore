// Registro de ferramentas dos agentes.
// Cada ferramenta tem contrato de entrada (JSON Schema), nível de permissão, agentes autorizados e um handler determinístico.
// Nível 1: executa. Nível 2: gera PROPOSTA que só o proprietário aprova. Nível 3: crítico, nunca executado por agente.
import * as D from "./dados.mjs";
import { salvarMemoria, buscarMemoria } from "./memoria.mjs";

export const NIVEL = { AUTONOMO: 1, APROVACAO: 2, CRITICO: 3 };
const TODOS = "*";
const obj = (props, required = []) => ({ type: "object", properties: props, required, additionalProperties: false });
const str = (d) => ({ type: "string", description: d });
const num = (d) => ({ type: "number", description: d });
const int = (d) => ({ type: "integer", description: d });

export const FERRAMENTAS = {
  parametros: { nivel: 1, agentes: TODOS, descricao: "Parâmetros atuais de custo: taxa fixa, % da nota, fretes, cotação do dólar.", schema: obj({}),
    handler: ({ state }) => ({ ...state.settings, formula: "custoUSD = lance + taxaFixa + lance×notaPct%×(frete1%+frete2%); custoBRL = custoUSD × cotacao" }) },
  listar_estoque: { nivel: 1, agentes: TODOS, descricao: "Estoque atual agrupado por modelo, com lotes, custo médio, preço de lista e lucro potencial. Fonte: compras e vendas registradas.", schema: obj({ modelo: str("filtro opcional por parte do nome") }),
    handler: ({ state }, { modelo }) => { const e = D.estoqueAgrupado(state); const f = modelo ? e.filter((g) => g.modelo.toLowerCase().includes(modelo.toLowerCase())) : e; return { referencia: D.hojeISO(), modelos: f, totalAparelhos: f.reduce((a, g) => a + g.qty, 0), capital: D.round2(f.reduce((a, g) => a + g.custoTotal, 0)) }; } },
  listar_compras: { nivel: 1, agentes: TODOS, descricao: "Compras registradas (lotes de leilão) com totais em US$ e R$.", schema: obj({ limite: int("máximo de compras, mais recentes primeiro (padrão 20)") }),
    handler: ({ state }, { limite = 20 }) => (state.compras || []).slice(0, limite).map((c) => { const t = D.calcTotais(c.rows, c.settings || state.settings); return { id: c.id, nome: c.nome, data: c.data, situacao: D.emTransito(c) ? "em_transito (fora do estoque até chegar)" : "recebida", recebidaEm: c.recebidaEm || null, aparelhos: t.qty, lanceTotalUSD: D.round2(t.preco), notaDeclaradaUSD: D.round2(t.nota), custoUSD: D.round2(t.usd), custoBRL: D.round2(t.brl), cotacao: (c.settings || state.settings).cotacao, itens: (c.rows || []).map((r) => { const k = D.calcRow(r, c.settings || state.settings); return { modelo: r.modelo, qty: k.qty, lance: k.preco, custoBRL: D.round2(k.custoBRL), vendidos: D.soldQty(state, c.id, r.id) }; }) }; }) },
  listar_vendas: { nivel: 1, agentes: TODOS, descricao: "Vendas registradas num período, com cliente, itens, custo, lucro e margem.", schema: obj({ de: str("data inicial AAAA-MM-DD"), ate: str("data final AAAA-MM-DD"), limite: int("máximo (padrão 50)") }),
    handler: ({ state }, { de, ate, limite = 50 }) => D.vendasPeriodo(state, { de, ate }).slice(0, limite).map((v) => { const t = D.vendaTotais(state, v); return { id: v.id, data: v.data, cliente: v.clienteNome, aparelhos: t.qty, venda: D.round2(t.venda), custo: D.round2(t.custo), lucro: D.round2(t.lucro), margem: t.margem !== null ? D.round1(t.margem) : null, itens: (v.itens || []).map((i) => ({ modelo: i.modelo, qty: i.qty, preco: i.preco, custo: D.round2(D.itemCusto(state, i)), obs: i.obs || "" })) }; }) },
  lista_precos: { nivel: 1, agentes: TODOS, descricao: "Lista de preços de venda (base para precificação e margem).", schema: obj({ modelo: str("filtro opcional") }),
    handler: ({ state }, { modelo }) => (state.precos || []).filter((p) => !modelo || p.modelo.toLowerCase().includes(modelo.toLowerCase())).map((p) => ({ modelo: p.modelo, preco: p.preco })) },
  listar_clientes: { nivel: 1, agentes: TODOS, descricao: "Clientes cadastrados com totais comprados.", schema: obj({}),
    handler: ({ state }) => (state.clientes || []).map((c) => { const vs = (state.vendas || []).filter((v) => v.clienteId === c.id); let fat = 0, lucro = 0, qty = 0; vs.forEach((v) => { const t = D.vendaTotais(state, v); fat += t.venda; lucro += t.lucro; qty += t.qty; }); return { id: c.id, nome: c.nome, telefone: c.telefone || "", vendas: vs.length, aparelhos: qty, faturamento: D.round2(fat), lucro: D.round2(lucro), ultimaCompra: vs.map((v) => v.data).sort().pop() || null }; }) },
  calcular_custo: { nivel: 1, agentes: TODOS, descricao: "Custo em SP de um aparelho dado o lance em US$ (usa os parâmetros atuais).", schema: obj({ lance: num("lance em US$"), notaPct: num("% da nota, opcional (padrão dos parâmetros)") }, ["lance"]),
    handler: ({ state }, { lance, notaPct }) => { const c = D.calcRow({ preco: lance, notaPct: notaPct ?? null }, state.settings); return { lance, notaPct: c.notaPct, valorNota: D.round2(c.valorNota), frete1: D.round2(c.frete1), frete2: D.round2(c.frete2), taxaFixa: c.taxa, custoUSD: D.round2(c.custoUSD), cotacao: c.cotacao, custoBRL: D.round2(c.custoBRL) }; } },
  analisar_lances: { nivel: 1, agentes: ["AGENTE_01_COMPRAS", "AGENTE_04_PRECIFICACAO", "AGENTE_10_INTELIGENCIA", "AGENTE_11_AUDITOR", "AGENTE_00_COORDENADOR"], descricao: "Avalia lances contra a lista de preços: custo, lucro, margem, lance máximo e veredito por linha.", schema: obj({ linhas: { type: "array", items: obj({ modelo: str("modelo com capacidade, ex: iPhone 14 128GB"), lance: num("lance US$"), qty: int("quantidade"), venda: num("preço de venda R$, opcional; senão usa a lista") }, ["modelo", "lance"]) }, margem: num("meta de lucro em % (padrão 20)"), base: { type: "string", enum: ["venda", "custo"] } }, ["linhas"]),
    handler: ({ state }, input) => D.analisarLances(state, input) },
  giro_por_modelo: { nivel: 1, agentes: TODOS, descricao: "Velocidade de venda por modelo (unidades/semana), estoque e semanas de cobertura.", schema: obj({ dias: int("janela em dias (padrão 90)") }),
    handler: ({ state, agora }, { dias = 90 }) => D.giroPorModelo(state, { dias, agora }) },
  aparelhos_parados: { nivel: 1, agentes: TODOS, descricao: "Lotes com aparelhos disponíveis há mais de N dias (capital parado).", schema: obj({ dias: int("mínimo de dias parado (padrão 30)") }),
    handler: ({ state, agora }, { dias = 30 }) => D.aparelhosParados(state, { dias, agora }) },
  resumo_financeiro: { nivel: 1, agentes: TODOS, descricao: "Faturamento, custo das vendas, lucro bruto, margem, ticket médio, capital em estoque, por cliente e por modelo. Não inclui despesas (não existem no sistema).", schema: obj({ de: str("AAAA-MM-DD"), ate: str("AAAA-MM-DD") }),
    handler: ({ state }, { de, ate }) => D.resumoFinanceiro(state, { de, ate }) },
  previsao_demanda: { nivel: 1, agentes: ["AGENTE_09_PREVISAO", "AGENTE_01_COMPRAS", "AGENTE_10_INTELIGENCIA", "AGENTE_11_AUDITOR", "AGENTE_00_COORDENADOR"], descricao: "Média e desvio semanal de vendas por modelo, demanda prevista, estoque de segurança e sugestão de compra, com grau de incerteza.", schema: obj({ semanas: int("janela histórica em semanas (padrão 8)"), horizonteSemanas: int("horizonte da previsão (padrão 4)") }),
    handler: ({ state, agora }, { semanas = 8, horizonteSemanas = 4 }) => D.previsaoDemanda(state, { semanas, horizonteSemanas, agora }) },
  inconsistencias: { nivel: 1, agentes: TODOS, descricao: "Verificações de integridade: estoque negativo, venda sem compra, lance zerado, modelo sem preço, cliente duplicado, venda abaixo do custo.", schema: obj({}),
    handler: ({ state }) => D.inconsistencias(state) },
  buscar_memoria: { nivel: 1, agentes: TODOS, descricao: "Busca na memória persistente (análises, decisões, relatórios, erros, regras) por palavras-chave e filtros.", schema: obj({ consulta: str("palavras-chave"), tipo: str("tipo opcional: analise, decisao, relatorio, alerta, recomendacao, erro, regra_comercial, procedimento"), agente: str("agente opcional"), aparelho: str("modelo opcional"), limite: int("máximo (padrão 8)") }),
    handler: async ({ memoria }, input) => (await buscarMemoria(memoria, input)).map((d) => ({ id: d.id, titulo: d.titulo, tipo: d.tipo, agente: d.agente, data: d.data, tarefa: d.tarefa, conteudo: d.conteudo.slice(0, 2000) })) },
  salvar_memoria: { nivel: 1, agentes: TODOS, descricao: "Grava um registro na memória persistente (análise, decisão, alerta, recomendação, erro, regra). Nunca grave dados transacionais.", schema: obj({ titulo: str("título curto"), conteudo: str("texto do registro"), tipo: { type: "string", enum: ["analise", "decisao", "alerta", "recomendacao", "erro", "regra_comercial", "procedimento", "relatorio", "fornecedor"] }, palavras: { type: "array", items: { type: "string" } }, aparelho: str("modelo, se for sobre um aparelho") }, ["titulo", "conteudo", "tipo"]),
    handler: async ({ memoria, agente, tarefa }, input) => { const d = await salvarMemoria(memoria, { ...input, palavras: input.palavras || [], agente, tarefa }); return { ok: true, id: d.id }; } },
  listar_gastos: { nivel: 1, agentes: TODOS, descricao: "Gastos lançados (frete, embalagem, taxa, deslocamento, assistência, marketing, outros) num período, com total por categoria e vínculo opcional a uma compra.", schema: obj({ de: str("AAAA-MM-DD"), ate: str("AAAA-MM-DD"), compraId: str("filtrar por compra") }),
    handler: ({ state }, { de, ate, compraId }) => { const l = D.gastosPeriodo(state, { de, ate, compraId }); const cat = {}; l.forEach((g) => { cat[g.categoriaDescricao] = D.round2((cat[g.categoriaDescricao] || 0) + g.valor); }); return { total: D.round2(l.reduce((a, g) => a + g.valor, 0)), porCategoria: cat, lancamentos: l }; } },
  listar_perdas: { nivel: 1, agentes: TODOS, descricao: "Saídas sem venda (roubo, defeito, brinde, troca em garantia, uso próprio) num período, pelo custo de importação.", schema: obj({ de: str("AAAA-MM-DD"), ate: str("AAAA-MM-DD") }),
    handler: ({ state }, { de, ate }) => { const l = D.perdasPeriodo(state, { de, ate }); return { total: D.round2(l.reduce((a, p) => a + p.custoTotal, 0)), aparelhos: l.reduce((a, p) => a + p.qty, 0), saidas: l }; } },
  byl_estoque: { nivel: 1, agentes: TODOS, descricao: "Estoque do BYL STORE (Xiaomi/Samsung) lido do Supabase: código, nome, quantidade e custo.", schema: obj({}),
    handler: ({ byl }) => byl ? byl.estoque.map((r) => ({ cod: r.cod, nome: r.short || r.nome, usd: D.numOr(r.usd, 0), qtd: D.numOr(r.qtd, 0), custoTotal: D.round2(D.numOr(r.custo_total, 0)), custoMedio: D.numOr(r.qtd, 0) > 0 ? D.round2(D.numOr(r.custo_total, 0) / D.numOr(r.qtd, 0)) : null })) : { indisponivel: "SUPABASE_URL/SUPABASE_ANON_KEY não configurados ou leitura falhou." } },
  byl_crediario: { nivel: 1, agentes: TODOS, descricao: "Crediário do BYL STORE: contratos, parcelas pagas/pendentes/vencidas, recebido, inadimplência, lucro esperado × realizado.", schema: obj({}),
    handler: ({ byl, agora }) => byl ? D.bylCrediario(byl, { agora }) : { indisponivel: "SUPABASE_URL/SUPABASE_ANON_KEY não configurados ou leitura falhou." } },

  // ---------- nível 2: propostas (só o proprietário executa) ----------
  propor_preco_lista: { nivel: 2, agentes: ["AGENTE_04_PRECIFICACAO", "AGENTE_10_INTELIGENCIA", "AGENTE_00_COORDENADOR"], descricao: "Propõe alterar o preço de venda de um modelo na lista. Não altera nada: cria pedido de aprovação.", schema: obj({ modelo: str("modelo exatamente como na lista, ou novo"), preco: num("novo preço R$"), justificativa: str("dados e cálculo que sustentam") }, ["modelo", "preco", "justificativa"]),
    handler: (ctx, input) => ({ tipo: "preco_lista", ...input }) },
  propor_compra: { nivel: 2, agentes: ["AGENTE_01_COMPRAS", "AGENTE_10_INTELIGENCIA", "AGENTE_00_COORDENADOR"], descricao: "Propõe registrar uma compra (lote de leilão) no sistema. Não registra: cria pedido de aprovação.", schema: obj({ nome: str("nome da compra, ex: Leilão 22/10"), itens: { type: "array", items: obj({ modelo: str("modelo"), lance: num("US$"), qty: int("quantidade") }, ["modelo", "lance", "qty"]) }, justificativa: str("análise que sustenta") }, ["nome", "itens", "justificativa"]),
    handler: (ctx, input) => ({ tipo: "compra", ...input }) },

  // ---------- nível 3: crítico (declarado, nunca executável por agente) ----------
  excluir_registro: { nivel: 3, agentes: [], descricao: "Exclusão de registros. Operação crítica: não disponível para agentes.", schema: obj({ tipo: str(""), id: str("") }, ["tipo", "id"]), handler: () => { throw new Error("Operação crítica bloqueada."); } },
};

export function ferramentasPara(agente) {
  return Object.entries(FERRAMENTAS).filter(([, f]) => f.nivel < 3 && (f.agentes === TODOS || f.agentes.includes(agente)))
    .map(([name, f]) => ({ name, description: f.descricao + (f.nivel === 2 ? " [NÍVEL 2: gera pedido de aprovação]" : ""), input_schema: f.schema }));
}
export function autorizado(agente, nome) {
  const f = FERRAMENTAS[nome]; if (!f) return false;
  return f.nivel < 3 && (f.agentes === TODOS || f.agentes.includes(agente));
}
function validar(schema, input) {
  const erros = [];
  (schema.required || []).forEach((k) => { if (input[k] === undefined || input[k] === null || input[k] === "") erros.push("campo obrigatório: " + k); });
  Object.keys(input || {}).forEach((k) => { if (!schema.properties[k]) erros.push("campo desconhecido: " + k); });
  Object.entries(schema.properties).forEach(([k, p]) => { const v = input[k]; if (v === undefined || v === null) return; if (p.type === "number" && typeof v !== "number") erros.push(k + " deve ser número"); if (p.type === "integer" && !Number.isInteger(v)) erros.push(k + " deve ser inteiro"); if (p.type === "string" && typeof v !== "string") erros.push(k + " deve ser texto"); if (p.type === "array" && !Array.isArray(v)) erros.push(k + " deve ser lista"); if (p.enum && !p.enum.includes(v)) erros.push(k + " deve ser um de: " + p.enum.join(", ")); });
  return erros;
}
// Executa uma ferramenta em nome de um agente. Devolve { ok, resultado } | { ok, proposta } | { ok:false, erro }.
export async function executarFerramenta(nome, input, ctx) {
  const f = FERRAMENTAS[nome];
  if (!f) return { ok: false, erro: "Ferramenta inexistente: " + nome };
  if (!autorizado(ctx.agente, nome)) return { ok: false, erro: `Agente ${ctx.agente} não autorizado a usar ${nome}.` };
  const erros = validar(f.schema, input || {});
  if (erros.length) return { ok: false, erro: "Entrada inválida: " + erros.join("; ") };
  try {
    const r = await f.handler(ctx, input || {});
    if (f.nivel === 2) return { ok: true, proposta: { ...r, ferramenta: nome, agente: ctx.agente, criadaEm: new Date().toISOString() }, resultado: { aguardando_aprovacao: true, proposta: r } };
    return { ok: true, resultado: r };
  } catch (e) { return { ok: false, erro: String(e && e.message ? e.message : e) }; }
}

// Execução de propostas APROVADAS pelo proprietário (chamada apenas pela rota de aprovação).
export async function executarProposta(st, proposta) {
  const { dados, updatedAt } = await D.carregarEstado(st);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  let descricao;
  if (proposta.tipo === "preco_lista") {
    const ex = (dados.precos || []).find((p) => p.modelo.trim().toLowerCase() === String(proposta.modelo).trim().toLowerCase());
    if (ex) { descricao = `Preço de "${ex.modelo}" alterado de R$ ${ex.preco} para R$ ${proposta.preco}.`; ex.preco = D.numOr(proposta.preco, 0); }
    else { dados.precos.push({ id: uid(), modelo: String(proposta.modelo).trim(), preco: D.numOr(proposta.preco, 0) }); descricao = `Modelo "${proposta.modelo}" adicionado à lista a R$ ${proposta.preco}.`; }
  } else if (proposta.tipo === "compra") {
    const rows = (proposta.itens || []).map((i) => ({ id: uid(), modelo: String(i.modelo).trim(), preco: D.numOr(i.lance, 0), notaPct: null, qty: Math.max(1, Math.round(D.numOr(i.qty, 1))) }));
    if (!rows.length) throw new Error("Proposta de compra sem itens.");
    const snap = {}; ["taxaFixa", "notaPct", "frete1", "frete2", "cotacao"].forEach((k) => { snap[k] = dados.settings[k]; });
    const c = { id: uid(), nome: proposta.nome || ("Compra " + D.hojeISO()), data: D.hojeISO(), settings: snap, rows, criadoEm: Date.now(), origem: "agente" };
    dados.compras.unshift(c);
    const t = D.calcTotais(rows, snap);
    descricao = `Compra "${c.nome}" registrada: ${t.qty} aparelho(s), custo R$ ${D.round2(t.brl)}.`;
  } else throw new Error("Tipo de proposta desconhecido: " + proposta.tipo);
  const r = await D.gravarEstado(st, dados, updatedAt);
  if (r.conflict) throw new Error("Conflito de sincronização: o app salvou dados mais novos. Tente aprovar de novo.");
  return { ok: true, descricao, updatedAt: r.updatedAt };
}
