// Dados oficiais e cálculos determinísticos da camada de agentes.
// Fonte oficial: blob "state" (Gestão de Aparelhos) e Supabase do BYL (somente leitura).
// Nenhuma função aqui chama IA. Tudo é verificável.
import { store } from "./auth.mjs";

export const numOr = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const isBlank = (v) => v === null || v === undefined || v === "";

export const DEFAULT_SETTINGS = { taxaFixa: 17, notaPct: 70, frete1: 7.5, frete2: 8, cotacao: 5.4, empresa: "", contato: "" };

/* ---------------- cálculo (espelho exato do app) ---------------- */
export function calcRow(row, s) {
  if (row.custoBRL !== null && row.custoBRL !== undefined && row.custoBRL !== "") {
    const custoBRL = numOr(row.custoBRL, 0); const cot = numOr(s.cotacao, 0); const custoUSD = cot > 0 ? custoBRL / cot : 0;
    const qty = Math.max(1, Math.round(numOr(row.qty, 1)));
    return { preco: 0, notaPct: 0, valorNota: 0, frete1: 0, frete2: 0, taxa: 0, custoUSD, custoBRL, qty, cotacao: cot, direto: true, lPreco: 0, lNota: 0, lF1: 0, lF2: 0, lTaxa: 0, lUSD: custoUSD * qty, lBRL: custoBRL * qty };
  }
  const preco = numOr(row.preco, 0);
  const notaPct = isBlank(row.notaPct) ? numOr(s.notaPct, 0) : numOr(row.notaPct, 0);
  const valorNota = preco * notaPct / 100;
  const frete1 = valorNota * numOr(s.frete1, 0) / 100;
  const frete2 = valorNota * numOr(s.frete2, 0) / 100;
  const taxa = numOr(s.taxaFixa, 0);
  const custoUSD = preco + taxa + frete1 + frete2;
  const cot = numOr(s.cotacao, 0);
  const custoBRL = custoUSD * cot;
  const qty = Math.max(1, Math.round(numOr(row.qty, 1)));
  return { preco, notaPct, valorNota, frete1, frete2, taxa, custoUSD, custoBRL, qty, cotacao: cot,
    lPreco: preco * qty, lNota: valorNota * qty, lF1: frete1 * qty, lF2: frete2 * qty, lTaxa: taxa * qty, lUSD: custoUSD * qty, lBRL: custoBRL * qty };
}
export function calcTotais(rows, s) {
  const t = { qty: 0, preco: 0, nota: 0, f1: 0, f2: 0, taxa: 0, usd: 0, brl: 0 };
  (rows || []).forEach((r) => { const c = calcRow(r, s); t.qty += c.qty; t.preco += c.lPreco; t.nota += c.lNota; t.f1 += c.lF1; t.f2 += c.lF2; t.taxa += c.lTaxa; t.usd += c.lUSD; t.brl += c.lBRL; });
  return t;
}
export function soldQty(state, compraId, rowId) {
  let n = 0;
  (state.vendas || []).forEach((v) => (v.itens || []).forEach((i) => { if (i.compraId === compraId && i.rowId === rowId) n += numOr(i.qty, 0); }));
  return n;
}
export function lostQty(state, compraId, rowId) {
  let n = 0;
  (state.perdas || []).forEach((p) => { if (p.compraId === compraId && p.rowId === rowId) n += numOr(p.qty, 0); });
  return n;
}
export function stockList(state) {
  const out = [];
  (state.compras || []).forEach((c) => (c.rows || []).forEach((r) => {
    const k = calcRow(r, c.settings || state.settings || DEFAULT_SETTINGS);
    const sold = soldQty(state, c.id, r.id); const lost = lostQty(state, c.id, r.id);
    out.push({ key: c.id + "|" + r.id, compraId: c.id, rowId: r.id, compraNome: c.nome, compraData: c.data, modelo: r.modelo,
      custoUSD: k.custoUSD, custoBRL: k.custoBRL, qty: k.qty, sold, lost, avail: k.qty - sold - lost });
  }));
  return out;
}
export const MOTIVOS_PERDA = { roubo: "Roubo / furto", defeito: "Defeito sem conserto", brinde: "Brinde / doação", troca: "Troca em garantia", uso: "Uso próprio", outro: "Outro" };
export const CATEGORIAS_GASTO = { frete: "Frete / transporte", embalagem: "Embalagem", taxa: "Taxa de pagamento", deslocamento: "Deslocamento", assistencia: "Assistência / reparo", marketing: "Marketing", outros: "Outros" };
export function perdasPeriodo(state, { de, ate } = {}) {
  return (state.perdas || []).filter((p) => (!de || p.data >= de) && (!ate || p.data <= ate)).map((p) => { const custo = itemCusto(state, { compraId: p.compraId, rowId: p.rowId, custoBRL: p.custoBRL }); return { id: p.id, data: p.data, modelo: p.modelo, qty: numOr(p.qty, 0), motivo: p.motivo, motivoDescricao: MOTIVOS_PERDA[p.motivo] || p.motivo, descricao: p.descricao || "", imeis: (p.imeis || []).filter(Boolean), custoUnit: round2(custo), custoTotal: round2(custo * numOr(p.qty, 0)) }; });
}
export function gastosPeriodo(state, { de, ate, compraId } = {}) {
  return (state.gastos || []).filter((g) => (!de || g.data >= de) && (!ate || g.data <= ate) && (!compraId || g.compraId === compraId)).map((g) => ({ id: g.id, data: g.data, categoria: g.categoria, categoriaDescricao: CATEGORIAS_GASTO[g.categoria] || g.categoria, valor: round2(numOr(g.valor, 0)), descricao: g.descricao || "", compraId: g.compraId || null }));
}
export function itemCusto(state, i) {
  const c = (state.compras || []).find((x) => x.id === i.compraId);
  const r = c && (c.rows || []).find((x) => x.id === i.rowId);
  if (c && r) return calcRow(r, c.settings || state.settings || DEFAULT_SETTINGS).custoBRL;
  return numOr(i.custoBRL, 0);
}
export function vendaTotais(state, v) {
  let qty = 0, venda = 0, custo = 0;
  (v.itens || []).forEach((i) => { const q = numOr(i.qty, 0), p = numOr(i.preco, 0), c = itemCusto(state, i); qty += q; venda += p * q; custo += c * q; });
  return { qty, venda, custo, lucro: venda - custo, margem: venda > 0 ? (venda - custo) / venda * 100 : null };
}

/* ---------------- casamento de modelo com a lista de preços ---------------- */
const MODIFIERS = ["pro", "max", "plus", "mini"];
export const normalizarModelo = (t) => String(t || "").toLowerCase().replace(/gb/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
export function precoEntrada(state, modelo) {
  const mods = (t) => MODIFIERS.filter((m) => new RegExp("\\b" + m + "\\b").test(t)).join(",");
  const a = normalizarModelo(modelo); if (!a) return null;
  const ac = a.replace(/\s+/g, ""), am = mods(a);
  let best = null, score = 0;
  (state.precos || []).forEach((p) => {
    const b = normalizarModelo(p.modelo); if (!b || !(numOr(p.preco, 0) > 0)) return;
    const bc = b.replace(/\s+/g, "");
    if (mods(b) !== am) return;
    let sc = 0;
    if (ac === bc) sc = 1000; else if (ac.startsWith(bc) || bc.startsWith(ac)) sc = Math.min(ac.length, bc.length);
    if (sc > score) { score = sc; best = p; }
  });
  return best;
}
export const precoTabela = (state, modelo) => { const e = precoEntrada(state, modelo); return e ? numOr(e.preco, 0) : null; };

/* ---------------- análises derivadas (determinísticas) ---------------- */
export function estoqueAgrupado(state) {
  const groups = new Map();
  stockList(state).filter((s) => s.avail > 0).forEach((s) => {
    const k = String(s.modelo || "").trim().toLowerCase().replace(/\s+/g, " ");
    if (!groups.has(k)) groups.set(k, { modelo: String(s.modelo || "").trim(), qty: 0, custoBRL: 0, custoUSD: 0, lotes: [] });
    const g = groups.get(k);
    g.qty += s.avail; g.custoBRL += s.avail * s.custoBRL; g.custoUSD += s.avail * s.custoUSD;
    g.lotes.push({ compra: s.compraNome, data: s.compraData, disponivel: s.avail, vendidos: s.sold, perdidos: s.lost, custoBRL: round2(s.custoBRL), custoUSD: round2(s.custoUSD) });
  });
  return [...groups.values()].map((g) => {
    const venda = precoTabela(state, g.modelo);
    const custoMedio = g.qty ? g.custoBRL / g.qty : 0;
    return { modelo: g.modelo, qty: g.qty, custoMedio: round2(custoMedio), custoTotal: round2(g.custoBRL), vendaLista: venda,
      lucroUnit: venda !== null ? round2(venda - custoMedio) : null, lucroPotencial: venda !== null ? round2((venda - custoMedio) * g.qty) : null,
      margem: venda ? round1((venda - custoMedio) / venda * 100) : null, lotes: g.lotes };
  }).sort((a, b) => a.modelo.localeCompare(b.modelo, "pt-BR", { numeric: true }));
}

export const round2 = (n) => Math.round(numOr(n, 0) * 100) / 100;
export const round1 = (n) => Math.round(numOr(n, 0) * 10) / 10;
export const hojeISO = (agora = new Date()) => new Date(agora.getTime() - agora.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const diasEntre = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);

export function vendasPeriodo(state, { de, ate, clienteId } = {}) {
  return (state.vendas || []).filter((v) => (!de || v.data >= de) && (!ate || v.data <= ate) && (!clienteId || v.clienteId === clienteId));
}
export function resumoFinanceiro(state, { de, ate } = {}) {
  const vendas = vendasPeriodo(state, { de, ate });
  let faturamento = 0, custo = 0, qty = 0; const porCliente = new Map(); const porModelo = new Map();
  vendas.forEach((v) => {
    const t = vendaTotais(state, v); faturamento += t.venda; custo += t.custo; qty += t.qty;
    const c = porCliente.get(v.clienteNome) || { cliente: v.clienteNome, vendas: 0, faturamento: 0, lucro: 0 };
    c.vendas += 1; c.faturamento += t.venda; c.lucro += t.lucro; porCliente.set(v.clienteNome, c);
    (v.itens || []).forEach((i) => { const m = porModelo.get(i.modelo) || { modelo: i.modelo, qty: 0, faturamento: 0, lucro: 0 }; const cu = itemCusto(state, i); m.qty += numOr(i.qty, 0); m.faturamento += numOr(i.preco, 0) * numOr(i.qty, 0); m.lucro += (numOr(i.preco, 0) - cu) * numOr(i.qty, 0); porModelo.set(i.modelo, m); });
  });
  const estoque = estoqueAgrupado(state);
  const capitalEstoque = estoque.reduce((a, g) => a + g.custoTotal, 0);
  const gastosLista = gastosPeriodo(state, { de, ate }); const gastos = gastosLista.reduce((a, g) => a + g.valor, 0);
  const gastosCat = {}; gastosLista.forEach((g) => { gastosCat[g.categoria] = (gastosCat[g.categoria] || 0) + g.valor; });
  const perdasLista = perdasPeriodo(state, { de, ate }); const perdas = perdasLista.reduce((a, p) => a + p.custoTotal, 0);
  return {
    periodo: { de: de || null, ate: ate || null }, vendas: vendas.length, aparelhos: qty,
    faturamento: round2(faturamento), custoDasVendas: round2(custo), lucroBruto: round2(faturamento - custo),
    margemBruta: faturamento > 0 ? round1((faturamento - custo) / faturamento * 100) : null,
    ticketMedio: vendas.length ? round2(faturamento / vendas.length) : null,
    capitalEmEstoque: round2(capitalEstoque), aparelhosEmEstoque: estoque.reduce((a, g) => a + g.qty, 0),
    gastos: round2(gastos), gastosPorCategoria: Object.entries(gastosCat).map(([k, v]) => ({ categoria: CATEGORIAS_GASTO[k] || k, valor: round2(v) })).sort((a, b) => b.valor - a.valor),
    perdas: round2(perdas), perdasAparelhos: perdasLista.reduce((a, p) => a + p.qty, 0),
    resultadoLiquido: round2(faturamento - custo - gastos - perdas),
    porCliente: [...porCliente.values()].map((c) => ({ ...c, faturamento: round2(c.faturamento), lucro: round2(c.lucro) })).sort((a, b) => b.faturamento - a.faturamento),
    porModelo: [...porModelo.values()].map((m) => ({ ...m, faturamento: round2(m.faturamento), lucro: round2(m.lucro) })).sort((a, b) => b.lucro - a.lucro),
    observacao: "Lucro bruto = venda − custo de importação. Resultado líquido = lucro bruto − gastos lançados − perdas (saídas sem venda pelo custo). Não há tributos, tarifas automáticas nem contas a pagar cadastrados.",
  };
}
export function giroPorModelo(state, { dias = 90, agora = new Date() } = {}) {
  const hoje = hojeISO(agora);
  const de = new Date(agora.getTime() - dias * 86400000); const deISO = hojeISO(de);
  const vendidos = new Map();
  vendasPeriodo(state, { de: deISO, ate: hoje }).forEach((v) => (v.itens || []).forEach((i) => { const k = normalizarModelo(i.modelo); vendidos.set(k, (vendidos.get(k) || 0) + numOr(i.qty, 0)); }));
  const estoque = estoqueAgrupado(state);
  const semanas = Math.max(1, dias / 7);
  const modelos = new Set([...estoque.map((g) => normalizarModelo(g.modelo)), ...vendidos.keys()]);
  const out = [];
  modelos.forEach((k) => {
    const g = estoque.find((x) => normalizarModelo(x.modelo) === k);
    const vend = vendidos.get(k) || 0;
    const porSemana = vend / semanas;
    const emEstoque = g ? g.qty : 0;
    const idadeMax = g ? Math.max(...g.lotes.map((l) => diasEntre(l.data, hoje))) : null;
    out.push({ modelo: g ? g.modelo : k, vendidosNoPeriodo: vend, porSemana: round2(porSemana), emEstoque,
      semanasDeCobertura: porSemana > 0 ? round1(emEstoque / porSemana) : (emEstoque > 0 ? null : 0), diasDoLoteMaisAntigo: idadeMax });
  });
  return { dias, de: deISO, ate: hoje, modelos: out.sort((a, b) => b.porSemana - a.porSemana) };
}
export function aparelhosParados(state, { dias = 30, agora = new Date() } = {}) {
  const hoje = hojeISO(agora);
  return stockList(state).filter((s) => s.avail > 0 && diasEntre(s.compraData, hoje) >= dias)
    .map((s) => ({ modelo: s.modelo, compra: s.compraNome, data: s.compraData, diasParado: diasEntre(s.compraData, hoje), disponivel: s.avail, custoBRL: round2(s.custoBRL), capitalParado: round2(s.avail * s.custoBRL), vendaLista: precoTabela(state, s.modelo) }))
    .sort((a, b) => b.diasParado - a.diasParado);
}
export function previsaoDemanda(state, { semanas = 8, horizonteSemanas = 4, agora = new Date() } = {}) {
  const hoje = hojeISO(agora);
  const inicio = new Date(agora.getTime() - semanas * 7 * 86400000);
  const porModeloSemana = new Map();
  vendasPeriodo(state, { de: hojeISO(inicio), ate: hoje }).forEach((v) => {
    const w = Math.floor((new Date(v.data + "T00:00:00") - inicio) / (7 * 86400000));
    (v.itens || []).forEach((i) => { const k = normalizarModelo(i.modelo); if (!porModeloSemana.has(k)) porModeloSemana.set(k, { modelo: i.modelo, semanas: new Array(semanas).fill(0) }); const e = porModeloSemana.get(k); if (w >= 0 && w < semanas) e.semanas[w] += numOr(i.qty, 0); });
  });
  const estoque = estoqueAgrupado(state);
  const total = [...porModeloSemana.values()].reduce((a, e) => a + e.semanas.reduce((x, y) => x + y, 0), 0);
  const modelos = [...porModeloSemana.values()].map((e) => {
    const n = e.semanas.length; const media = e.semanas.reduce((a, b) => a + b, 0) / n;
    const desvio = Math.sqrt(e.semanas.reduce((a, b) => a + (b - media) ** 2, 0) / Math.max(1, n - 1));
    const g = estoque.find((x) => normalizarModelo(x.modelo) === normalizarModelo(e.modelo));
    const emEstoque = g ? g.qty : 0;
    const demandaPrevista = media * horizonteSemanas;
    const seguranca = desvio * Math.sqrt(horizonteSemanas);
    return { modelo: e.modelo, vendasPorSemana: e.semanas, mediaSemanal: round2(media), desvioSemanal: round2(desvio), emEstoque,
      demandaPrevista: round1(demandaPrevista), estoqueSeguranca: round1(seguranca), sugestaoCompra: Math.max(0, Math.ceil(demandaPrevista + seguranca - emEstoque)),
      riscoExcesso: media > 0 ? emEstoque > demandaPrevista * 2 : emEstoque > 0 };
  }).sort((a, b) => b.mediaSemanal - a.mediaSemanal);
  return { janelaSemanas: semanas, horizonteSemanas, totalVendidoNaJanela: total, modelos,
    incerteza: total < 20 ? "ALTA: menos de 20 aparelhos vendidos na janela; use como ordem de grandeza, não como meta." : total < 60 ? "MÉDIA: base curta; revise a cada semana." : "MODERADA" };
}
export function inconsistencias(state) {
  const probs = [];
  const vistos = new Set();
  (state.compras || []).forEach((c) => {
    if (!c.rows || !c.rows.length) probs.push({ tipo: "compra_sem_itens", ref: c.id, detalhe: `Compra "${c.nome}" sem aparelhos.` });
    (c.rows || []).forEach((r) => {
      if (!(numOr(r.preco, 0) > 0) && !(numOr(r.custoBRL, 0) > 0)) probs.push({ tipo: "lance_zerado", ref: c.id + "|" + r.id, detalhe: `"${r.modelo}" na compra "${c.nome}" sem lance nem custo.` });
      const sold = soldQty(state, c.id, r.id) + lostQty(state, c.id, r.id);
      if (sold > numOr(r.qty, 0)) probs.push({ tipo: "estoque_negativo", ref: c.id + "|" + r.id, detalhe: `"${r.modelo}": ${sold} vendidos/baixados de ${r.qty} comprados.` });
      if (!precoEntrada(state, r.modelo)) probs.push({ tipo: "modelo_sem_preco", ref: c.id + "|" + r.id, detalhe: `"${r.modelo}" não tem preço na lista de venda.` });
    });
  });
  (state.vendas || []).forEach((v) => (v.itens || []).forEach((i) => {
    const c = (state.compras || []).find((x) => x.id === i.compraId); const r = c && (c.rows || []).find((x) => x.id === i.rowId);
    if (!c || !r) probs.push({ tipo: "venda_sem_compra", ref: v.id, detalhe: `Venda para "${v.clienteNome}" referencia compra inexistente (${i.modelo}).` });
    if (numOr(i.preco, 0) < itemCusto(state, i)) probs.push({ tipo: "venda_abaixo_do_custo", ref: v.id, detalhe: `"${i.modelo}" vendido a R$ ${numOr(i.preco, 0)} com custo R$ ${round2(itemCusto(state, i))}.` });
  }));
  (state.clientes || []).forEach((c) => { const k = String(c.nome || "").trim().toLowerCase(); if (vistos.has(k)) probs.push({ tipo: "cliente_duplicado", ref: c.id, detalhe: `Cliente "${c.nome}" repetido.` }); vistos.add(k); });
  (state.precos || []).forEach((p) => { if (!(numOr(p.preco, 0) > 0)) probs.push({ tipo: "preco_lista_zerado", ref: p.id, detalhe: `"${p.modelo}" na lista com preço zero.` }); });
  return probs;
}
export function analisarLances(state, { linhas = [], margem = 20, base = "venda" } = {}) {
  const s = state.settings || DEFAULT_SETTINGS; const m = numOr(margem, 0) / 100;
  const k = 1 + numOr(s.notaPct, 0) / 100 * (numOr(s.frete1, 0) + numOr(s.frete2, 0)) / 100;
  return linhas.map((l) => {
    const lance = numOr(l.lance, 0); const c = calcRow({ preco: lance, qty: l.qty || 1 }, s);
    const venda = l.venda ? numOr(l.venda, 0) : precoTabela(state, l.modelo);
    const lucro = venda !== null ? venda - c.custoBRL : null;
    const mg = venda !== null && venda > 0 ? (base === "custo" ? lucro / c.custoBRL : lucro / venda) * 100 : null;
    const custoMax = venda !== null ? (base === "custo" ? venda / (1 + m) : venda * (1 - m)) : null;
    const lanceMax = custoMax !== null && c.cotacao > 0 ? Math.max(0, (custoMax / c.cotacao - numOr(s.taxaFixa, 0)) / k) : null;
    return { modelo: l.modelo, lance, qty: l.qty || 1, custoUSD: round2(c.custoUSD), custoBRL: round2(c.custoBRL), vendaLista: venda, lucroUnit: lucro !== null ? round2(lucro) : null,
      margem: mg !== null ? round1(mg) : null, lanceMaximo: lanceMax !== null ? round2(lanceMax) : null, veredito: mg === null ? "sem_preco" : mg >= numOr(margem, 0) ? "bom" : "abaixo_da_meta" };
  });
}

/* ---------------- persistência: estado oficial ---------------- */
export function normalizarEstado(d) {
  d = d || {};
  return { settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) }, draft: d.draft || null, vendaDraft: d.vendaDraft || null, filtro: d.filtro || null, calc: d.calc || null,
    precos: Array.isArray(d.precos) ? d.precos : [], compras: Array.isArray(d.compras) ? d.compras : [], vendas: Array.isArray(d.vendas) ? d.vendas : [], clientes: Array.isArray(d.clientes) ? d.clientes : [],
    perdas: Array.isArray(d.perdas) ? d.perdas : [], gastos: Array.isArray(d.gastos) ? d.gastos : [], orcamentos: Array.isArray(d.orcamentos) ? d.orcamentos : [],
    ultimoBackup: d.ultimoBackup || null, updatedAt: numOr(d.updatedAt, 0) };
}
export async function carregarEstado(st = store()) {
  const rec = await st.get("state", { type: "json" });
  if (!rec) return { updatedAt: 0, dados: normalizarEstado(null), vazio: true };
  return { updatedAt: numOr(rec.updatedAt, 0), dados: normalizarEstado(rec.dados), vazio: false };
}
// Grava respeitando a concorrência otimista do app (mesma regra de /api/sync).
export async function gravarEstado(st, dados, baseUpdatedAt) {
  const cur = await st.get("state", { type: "json" });
  if (cur && numOr(cur.updatedAt, 0) !== numOr(baseUpdatedAt, 0)) return { conflict: true, updatedAt: cur.updatedAt };
  const updatedAt = Date.now();
  await st.setJSON("state", { updatedAt, dados: { ...dados, updatedAt }, salvoEm: new Date().toISOString(), origem: "agentes" });
  return { ok: true, updatedAt };
}

/* ---------------- BYL (Supabase, somente leitura) ---------------- */
export function bylConfigurado(env = (k) => (globalThis.Netlify ? Netlify.env.get(k) : process.env[k])) {
  return !!(env("SUPABASE_URL") && env("SUPABASE_ANON_KEY"));
}
export async function carregarBYL({ fetchImpl = fetch, env = (k) => (globalThis.Netlify ? Netlify.env.get(k) : process.env[k]) } = {}) {
  const url = env("SUPABASE_URL"), key = env("SUPABASE_ANON_KEY");
  if (!url || !key) return null;
  const get = async (t, q) => { const r = await fetchImpl(url.replace(/\/$/, "") + "/rest/v1/" + t + (q ? "?" + q : ""), { headers: { apikey: key, Authorization: "Bearer " + key } }); if (!r.ok) throw new Error("Supabase " + t + " " + r.status); return r.json(); };
  const [estoque, orcamentos] = await Promise.all([get("estoque", "select=cod,nome,short,usd,qtd,custo_total"), get("orcamentos", "select=id,criado,produto,custo,venda,status,venda_data,plano_esc,entrada,parcelas&order=criado.desc")]);
  const parse = (x) => { if (typeof x === "string") { try { return JSON.parse(x); } catch (e) { return null; } } return x; };
  return { estoque: estoque || [], orcamentos: (orcamentos || []).map((o) => ({ ...o, produto: parse(o.produto), parcelas: parse(o.parcelas) || [] })), lidoEm: new Date().toISOString() };
}
export function bylCrediario(byl, { agora = new Date() } = {}) {
  const hoje = hojeISO(agora);
  const vendas = (byl.orcamentos || []).filter((o) => o.status === "vendido");
  let faturado = 0, recebido = 0, pendente = 0, vencido = 0, custo = 0; const contratos = [];
  vendas.forEach((o) => {
    const parcs = o.parcelas || []; const pagas = parcs.filter((p) => p.pago); const abertas = parcs.filter((p) => !p.pago);
    const venc = abertas.filter((p) => p.venc < hoje);
    const rec = numOr(o.entrada, 0) + pagas.reduce((a, p) => a + numOr(p.valor, 0), 0);
    const pend = abertas.reduce((a, p) => a + numOr(p.valor, 0), 0);
    faturado += numOr(o.venda, 0); recebido += rec; pendente += pend; custo += numOr(o.custo, 0);
    vencido += venc.reduce((a, p) => a + numOr(p.valor, 0), 0);
    contratos.push({ id: o.id, produto: o.produto && (o.produto.short || o.produto.nome), vendaData: o.venda_data, venda: numOr(o.venda, 0), custo: numOr(o.custo, 0), entrada: numOr(o.entrada, 0), parcelas: parcs.length, pagas: pagas.length,
      recebido: round2(rec), pendente: round2(pend), vencidas: venc.map((p) => ({ num: p.num, venc: p.venc, valor: numOr(p.valor, 0), diasAtraso: diasEntre(p.venc, hoje) })), lucroEsperado: round2(numOr(o.venda, 0) - numOr(o.custo, 0)), lucroRealizado: round2(rec - numOr(o.custo, 0)) });
  });
  const comAtraso = contratos.filter((c) => c.vencidas.length);
  return { referencia: hoje, contratos: contratos.length, faturado: round2(faturado), recebido: round2(recebido), pendente: round2(pendente), vencido: round2(vencido), custoTotal: round2(custo),
    lucroEsperado: round2(faturado - custo), lucroRealizado: round2(recebido - custo), inadimplencia: pendente + recebido > 0 ? round1(vencido / (pendente + recebido) * 100) : null,
    contratosEmAtraso: comAtraso.sort((a, b) => b.vencidas.reduce((x, p) => x + p.diasAtraso, 0) - a.vencidas.reduce((x, p) => x + p.diasAtraso, 0)), lista: contratos };
}
