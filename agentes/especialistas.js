// agentes/especialistas.js — Agentes 01 a 10.
//
// Cada ação recebe (input, ctx) e devolve um resultado verificável:
//   { resumo, metricas: [{ nome, valor, unidade, metodo, tipo: "fato"|"estimativa" }],
//     itens, recomendacoes: [{ acao, motivo, dados, origem, data_referencia, metodo, resultado, limitacoes }],
//     limitacoes: [], dados_insuficientes }
// Os números saem de core/calculos.js e das ferramentas; nenhum número é escrito à mão.
// `conferir` é a verificação independente que o Auditor roda (relê os dados e recalcula).

import * as C from "../core/calculos.js";

const brl = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v) => (v == null ? null : Math.round(v * 10000) / 10000);
const m = (nome, valor, unidade, metodo, tipo = "fato") => ({ nome, valor, unidade, metodo, tipo });

function recomendacao({ acao, motivo, dados, ev, metodo, resultado, limitacoes = [] }) {
  return { acao, motivo, dados, origem: ev.fonte, data_referencia: ev.consultado_em, metodo, resultado, limitacoes };
}

function insuficiente(motivo, falta) {
  return {
    resumo: `Dados insuficientes: ${motivo}`,
    metricas: [],
    itens: [],
    recomendacoes: [],
    limitacoes: [motivo, ...falta.map((f) => `falta no sistema: ${f}`)],
    dados_insuficientes: true,
  };
}

// ── AGENTE 03 — ESTOQUE ─────────────────────────────────────────────
function analisarEstoque(estoque, { limiteBaixo = 2 } = {}) {
  const zerados = estoque.filter((e) => e.qtd === 0);
  const baixos = estoque.filter((e) => e.qtd > 0 && e.qtd <= limiteBaixo);
  const inconsistentes = [
    ...estoque.filter((e) => e.qtd < 0).map((e) => ({ cod: e.cod, problema: "quantidade negativa" })),
    ...estoque.filter((e) => e.qtd === 0 && e.custoTotal > 0.009).map((e) => ({ cod: e.cod, problema: "sem unidades mas com custo total" })),
    ...estoque.filter((e) => e.qtd > 0 && e.custoTotal <= 0).map((e) => ({ cod: e.cod, problema: "unidades sem custo" })),
  ];
  const porNome = new Map();
  for (const e of estoque) {
    const k = (e.nome || "").toUpperCase().replace(/\s+/g, " ").trim();
    porNome.set(k, [...(porNome.get(k) || []), e.cod]);
  }
  const duplicados = [...porNome.entries()].filter(([, cods]) => cods.length > 1).map(([nome, cods]) => ({ nome, cods }));
  const unidades = estoque.reduce((s, e) => s + Math.max(0, e.qtd), 0);
  const capital = C.centavos(estoque.reduce((s, e) => s + (e.qtd > 0 ? e.custoTotal : 0), 0));
  return { zerados, baixos, inconsistentes, duplicados, unidades, capital };
}

const AGENTE_03_ESTOQUE = {
  id: "AGENTE_03_ESTOQUE",
  nome: "Gestor de Estoque",
  acoes: {
    RESUMO_ESTOQUE: {
      descricao: "Unidades, capital parado, produtos zerados e baixos, inconsistências e possíveis duplicados",
      async executar(input, ctx) {
        const { saida, evidencia } = await ctx.usar("ler_estoque", {});
        const a = analisarEstoque(saida.dados, input);
        const recs = [];
        if (a.zerados.length) recs.push(recomendacao({
          acao: `Avaliar reposição de ${a.zerados.length} produto(s) zerado(s)`, motivo: "sem unidades para vender",
          dados: a.zerados.map((e) => e.cod), ev: evidencia, metodo: "qtd = 0", resultado: a.zerados.map((e) => e.short || e.nome),
          limitacoes: ["sem histórico de vendas não dá para dizer se vale repor"],
        }));
        if (a.inconsistentes.length) recs.push(recomendacao({
          acao: "Conferir os registros inconsistentes", motivo: "quantidade e custo não batem",
          dados: a.inconsistentes, ev: evidencia, metodo: "regras qtd/custo_total", resultado: a.inconsistentes.length,
        }));
        return {
          resumo: `${saida.dados.length} produtos, ${a.unidades} unidades, ${brl(a.capital)} em estoque a custo.`,
          metricas: [
            m("produtos_cadastrados", saida.dados.length, "produtos", "contagem de linhas da tabela estoque"),
            m("unidades_em_estoque", a.unidades, "unidades", "soma de qtd (qtd > 0)"),
            m("capital_em_estoque", a.capital, "BRL", "soma de custo_total dos produtos com qtd > 0"),
            m("produtos_zerados", a.zerados.length, "produtos", "qtd = 0"),
            m("produtos_estoque_baixo", a.baixos.length, "produtos", `0 < qtd ≤ ${input.limiteBaixo ?? 2}`),
          ],
          itens: saida.dados.map((e) => ({ cod: e.cod, produto: e.short || e.nome, qtd: e.qtd, custo_medio: C.centavos(C.custoMedio(e)) })),
          inconsistencias: a.inconsistentes,
          possiveis_duplicados: a.duplicados,
          recomendacoes: recs,
          limitacoes: [
            "estoque é por modelo, não por aparelho: não há IMEI, bateria, estado nem data de entrada",
            "sem data de entrada não dá para calcular tempo em estoque nem aparelhos parados",
          ],
          dados_insuficientes: false,
        };
      },
      async conferir(input, result, ctx) {
        const { saida } = await ctx.usar("ler_estoque", {});
        const a = analisarEstoque(saida.dados, input);
        const esperado = { unidades_em_estoque: a.unidades, capital_em_estoque: a.capital, produtos_zerados: a.zerados.length };
        return Object.entries(esperado)
          .filter(([k, v]) => result.metricas.find((x) => x.nome === k)?.valor !== v)
          .map(([k, v]) => `${k} não confere: recalculado ${v}`);
      },
    },
  },
};

// ── AGENTE 04 — PRECIFICAÇÃO ────────────────────────────────────────
function precificar(e, { multiplicador = 2.5, margemMinima = 0.3, taxaPct = 0, comissaoPct = 0 }) {
  const custo = C.custoMedio(e);
  if (!(custo > 0)) return null;
  const preco = C.centavos(custo * multiplicador);
  const minimo = C.precoMinimo({ custo, margemMinima, taxaPct, comissaoPct });
  return {
    cod: e.cod, produto: e.short || e.nome, custo_medio: C.centavos(custo), preco_base: preco,
    markup: pct(C.markup(preco, custo)), margem_bruta: pct(C.margemBruta(preco, custo)),
    margem_contribuicao: C.margemContribuicao({ preco, custo, taxaPct, comissaoPct }),
    preco_minimo: minimo, desconto_maximo: C.descontoMaximo(preco, minimo),
    planos: Object.fromEntries(Object.entries(C.PLANOS_PADRAO).map(([k, p]) => [k, C.planoParcelado(preco, p)])),
  };
}

const AGENTE_04_PRECIFICACAO = {
  id: "AGENTE_04_PRECIFICACAO",
  nome: "Especialista em Precificação",
  acoes: {
    SIMULAR_PRECOS: {
      descricao: "Preço base, markup, margem, preço mínimo e desconto máximo por produto (simulação, não altera preço)",
      async executar(input, ctx) {
        const { saida, evidencia } = await ctx.usar("ler_estoque", {});
        const itens = saida.dados.map((e) => precificar(e, input)).filter(Boolean);
        const piores = [...itens].sort((a, b) => a.margem_contribuicao.valor - b.margem_contribuicao.valor).slice(0, input.top ?? 5);
        return {
          resumo: `Simulação para ${itens.length} produtos com custo, multiplicador ${input.multiplicador ?? 2.5}×.`,
          metricas: [m("produtos_simulados", itens.length, "produtos", "produtos com custo médio > 0")],
          itens,
          menor_rentabilidade: piores.map((p) => ({ cod: p.cod, produto: p.produto, margem_contribuicao: p.margem_contribuicao.valor })),
          recomendacoes: [recomendacao({
            acao: "Trocar o rótulo 'Margem' da tela de orçamento por 'Markup' (ou mostrar os dois)",
            motivo: "o programa calcula (venda − custo) ÷ custo, que é markup",
            dados: itens.slice(0, 1).map((i) => ({ cod: i.cod, markup: i.markup, margem_bruta: i.margem_bruta })),
            ev: evidencia, metodo: "markup = (p−c)/c; margem = (p−c)/p", resultado: "rótulo incorreto",
          })],
          limitacoes: [
            "preço de mercado não disponível (Agente 02 sem fonte autorizada)",
            "frete, tributos e taxa do boleto não estão cadastrados; taxa usada: " + (input.taxaPct ?? 0),
            "simulação: nenhum preço foi alterado",
          ],
          dados_insuficientes: false,
        };
      },
      async conferir(input, result) {
        const erros = [];
        for (const i of result.itens) {
          if (Math.abs(i.preco_base - C.centavos(i.custo_medio * (input.multiplicador ?? 2.5))) > 0.02) erros.push(`${i.cod}: preço base não confere`);
          if (i.markup != null && i.margem_bruta != null && i.markup > 0 && i.margem_bruta >= i.markup) erros.push(`${i.cod}: margem ≥ markup (confusão de conceitos)`);
          if (i.preco_minimo > i.preco_base && i.desconto_maximo.valor !== 0) erros.push(`${i.cod}: desconto acima do mínimo`);
        }
        return erros;
      },
    },
  },
};

// ── AGENTE 05 — VENDAS / 06 — FINANCEIRO / 07 — CREDIÁRIO ──────────
async function vendas(ctx) {
  const { saida, evidencia } = await ctx.usar("ler_orcamentos", { status: "vendido" });
  return { vendas: saida.dados, evidencia };
}

const AGENTE_05_VENDAS = {
  id: "AGENTE_05_VENDAS",
  nome: "Analista de Vendas",
  acoes: {
    RESUMO_VENDAS: {
      descricao: "Faturamento (contratado), recebido e ticket médio por período",
      async executar(input, ctx) {
        const { vendas: vs, evidencia } = await vendas(ctx);
        const no = vs.filter((v) => (!input.de || v.vendaData >= input.de) && (!input.ate || v.vendaData <= input.ate));
        if (!no.length) return insuficiente("nenhuma venda registrada no período", ["vendas à vista, cartão e Pix (o programa só registra boleto)"]);
        const hoje = ctx.hoje();
        const s = no.map((v) => C.situacaoVenda(v, hoje));
        const fat = C.centavos(s.reduce((a, x) => a + x.contratado, 0));
        const rec = C.centavos(s.reduce((a, x) => a + x.recebido, 0));
        return {
          resumo: `${no.length} venda(s): faturamento ${brl(fat)}, recebido ${brl(rec)}.`,
          metricas: [
            m("vendas", no.length, "vendas", "orçamentos com status vendido no período"),
            m("faturamento_contratado", fat, "BRL", "entrada + soma das parcelas de cada venda"),
            m("recebido", rec, "BRL", "entrada + parcelas marcadas como pagas"),
            m("ticket_medio", C.centavos(fat / no.length), "BRL", "faturamento ÷ vendas"),
          ],
          itens: no.map((v, i) => ({ id: v.id, produto: v.produto?.short, data: v.vendaData, ...s[i] })),
          recomendacoes: [],
          limitacoes: ["faturamento é o valor contratado; lucro depende do Agente 06"],
          dados_insuficientes: false,
        };
      },
    },
  },
};

const AGENTE_06_FINANCEIRO = {
  id: "AGENTE_06_FINANCEIRO",
  nome: "Gestor Financeiro",
  acoes: {
    RENTABILIDADE: {
      descricao: "Lucro esperado e realizado por venda e capital em estoque",
      async executar(input, ctx) {
        const { vendas: vs, evidencia } = await vendas(ctx);
        const est = await ctx.usar("ler_estoque", {});
        const capital = C.centavos(est.saida.dados.reduce((s, e) => s + (e.qtd > 0 ? e.custoTotal : 0), 0));
        const metricas = [m("capital_em_estoque", capital, "BRL", "soma de custo_total com qtd > 0")];
        if (!vs.length) {
          const r = insuficiente("nenhuma venda registrada: sem receita não há lucro a calcular", ["despesas", "taxas de pagamento", "frete"]);
          return { ...r, metricas };
        }
        const hoje = ctx.hoje();
        const itens = vs.map((v) => ({ id: v.id, produto: v.produto?.short, custo: v.custo, ...C.situacaoVenda(v, hoje) }));
        return {
          resumo: `${vs.length} venda(s); lucro bruto esperado ${brl(itens.reduce((s, i) => s + i.lucroEsperado, 0))}, realizado ${brl(itens.reduce((s, i) => s + i.lucroRealizado, 0))}.`,
          metricas: [
            ...metricas,
            m("lucro_bruto_esperado", C.centavos(itens.reduce((s, i) => s + i.lucroEsperado, 0)), "BRL", "contratado − custo do aparelho", "estimativa"),
            m("lucro_bruto_realizado", C.centavos(itens.reduce((s, i) => s + i.lucroRealizado, 0)), "BRL", "recebido − custo do aparelho"),
          ],
          itens,
          recomendacoes: [],
          limitacoes: ["lucro BRUTO: o programa não tem despesas, taxas nem frete; lucro líquido não pode ser calculado"],
          dados_insuficientes: false,
        };
      },
    },
  },
};

const AGENTE_07_CREDIARIO = {
  id: "AGENTE_07_CREDIARIO",
  nome: "Gestor de Crediário",
  acoes: {
    PARCELAS: {
      descricao: "Parcelas vencidas e a vencer, valores pendentes e risco",
      async executar(input, ctx) {
        const { vendas: vs, evidencia } = await vendas(ctx);
        if (!vs.length) return insuficiente("nenhuma venda parcelada registrada", ["nome e contato do cliente nas vendas"]);
        const hoje = ctx.hoje();
        const dias = input.diasAVencer ?? 7;
        const vencidas = [];
        const aVencer = [];
        for (const v of vs) for (const p of v.parcelas || []) {
          if (p.pago) continue;
          const d = C.diasEntre(hoje, p.venc);
          const linha = { venda: v.id, produto: v.produto?.short, parcela: p.num, vencimento: p.venc, valor: p.valor, dias: d };
          if (d < 0) vencidas.push(linha); else if (d <= dias) aVencer.push(linha);
        }
        const s = vs.map((v) => C.situacaoVenda(v, hoje));
        const pendente = C.centavos(s.reduce((a, x) => a + x.pendente, 0));
        const atrasado = C.centavos(vencidas.reduce((a, x) => a + x.valor, 0));
        const recs = vencidas.length ? [recomendacao({
          acao: `Contatar ${new Set(vencidas.map((x) => x.venda)).size} cliente(s) com parcela vencida`,
          motivo: "parcelas vencidas e não marcadas como pagas", dados: vencidas, ev: evidencia,
          metodo: "parcela não paga com vencimento < hoje", resultado: atrasado,
          limitacoes: ["confirmar no extrato antes: a parcela pode ter sido paga e não marcada", "envio de cobrança é nível 2 (precisa de aprovação)"],
        })] : [];
        return {
          resumo: `${vencidas.length} parcela(s) vencida(s) somando ${brl(atrasado)}; ${aVencer.length} vencem em ${dias} dias.`,
          metricas: [
            m("parcelas_vencidas", vencidas.length, "parcelas", "não pagas com vencimento anterior a hoje"),
            m("valor_atrasado", atrasado, "BRL", "soma das parcelas vencidas"),
            m("saldo_a_receber", pendente, "BRL", "contratado − recebido"),
            m("inadimplencia_sobre_saldo", pendente > 0 ? atrasado / pendente : 0, "fração", "valor atrasado ÷ saldo a receber"),
          ],
          itens: { vencidas, a_vencer: aVencer },
          recomendacoes: recs,
          limitacoes: ["a venda não guarda nome nem telefone do cliente", "sem data de pagamento, não há histórico de atraso"],
          dados_insuficientes: false,
        };
      },
      async conferir(input, result, ctx) {
        const { saida } = await ctx.usar("ler_orcamentos", { status: "vendido" });
        const hoje = ctx.hoje();
        const n = saida.dados.flatMap((v) => v.parcelas || []).filter((p) => !p.pago && p.venc < hoje).length;
        const informado = result.metricas.find((x) => x.nome === "parcelas_vencidas");
        return informado && informado.valor !== n ? [`parcelas_vencidas não confere: recalculado ${n}`] : [];
      },
    },
  },
};

// ── Agentes sem dados suficientes no programa atual (respondem honestamente) ──
const AGENTE_01_COMPRAS = {
  id: "AGENTE_01_COMPRAS",
  nome: "Gestor de Compras",
  acoes: {
    ANALISAR_COMPRA: {
      descricao: "Sugestão de compra dentro de um orçamento, considerando custo e giro",
      async executar(input, ctx) {
        const est = await ctx.usar("ler_estoque", {});
        const { vendas: vs } = await vendas(ctx);
        if (vs.length < 5) {
          const r = insuficiente(`há ${vs.length} venda(s) registrada(s); sem giro histórico não dá para sugerir quantidades`, ["fornecedores", "frete e despesas por compra", "capital disponível"]);
          r.itens = est.saida.dados.filter((e) => e.qtd === 0).map((e) => ({ cod: e.cod, produto: e.short, situacao: "zerado" }));
          return r;
        }
        return insuficiente("cadastro de fornecedores e ofertas ainda não existe", ["fornecedores", "ofertas"]);
      },
    },
  },
};
const AGENTE_02_MERCADO = {
  id: "AGENTE_02_MERCADO",
  nome: "Analista de Mercado",
  acoes: {
    PESQUISAR_PRECOS: {
      descricao: "Preço atual de mercado por modelo, com fonte, data e condição",
      async executar() {
        return insuficiente("nenhuma fonte de preços autorizada foi configurada", ["lista de fontes autorizadas (sites/concorrentes) definida pelo proprietário"]);
      },
    },
  },
};
const AGENTE_08_GARANTIAS = {
  id: "AGENTE_08_GARANTIAS",
  nome: "Gestor de Garantias",
  acoes: {
    RESUMO_GARANTIAS: {
      descricao: "Prazos, defeitos recorrentes e custo de garantias",
      async executar() {
        return insuficiente("o programa não registra garantias nem manutenções", ["tabela de garantias", "aparelho individual (IMEI)", "fornecedor do aparelho"]);
      },
    },
  },
};
const AGENTE_09_DEMANDA = {
  id: "AGENTE_09_DEMANDA",
  nome: "Especialista em Previsão de Demanda",
  acoes: {
    PREVER_DEMANDA: {
      descricao: "Demanda estimada por modelo com incerteza",
      async executar(input, ctx) {
        const { vendas: vs } = await vendas(ctx);
        const minimo = input.minimoVendas ?? 30;
        if (vs.length < minimo) return insuficiente(`há ${vs.length} venda(s); previsão confiável precisa de pelo menos ${minimo}`, ["histórico de vendas de alguns meses"]);
        const meses = new Map();
        for (const v of vs) { const k = (v.vendaData || "").slice(0, 7); meses.set(k, (meses.get(k) || 0) + 1); }
        const serie = [...meses.values()];
        const media = serie.reduce((a, b) => a + b, 0) / serie.length;
        const dp = Math.sqrt(serie.reduce((a, b) => a + (b - media) ** 2, 0) / serie.length);
        return {
          resumo: `Média de ${media.toFixed(1)} vendas/mês (±${dp.toFixed(1)}).`,
          metricas: [m("vendas_mes_previstas", C.centavos(media), "vendas", "média mensal simples", "estimativa"), m("desvio_padrao", C.centavos(dp), "vendas", "desvio padrão mensal", "estimativa")],
          itens: [...meses.entries()].map(([mes, n]) => ({ mes, vendas: n })),
          recomendacoes: [],
          limitacoes: ["média simples; sazonalidade só com 12+ meses"],
          dados_insuficientes: false,
        };
      },
    },
  },
};

// ── AGENTE 10 — INTELIGÊNCIA COMERCIAL (cruza resultados de outros agentes) ──
const AGENTE_10_INTELIGENCIA = {
  id: "AGENTE_10_INTELIGENCIA",
  nome: "Inteligência Comercial",
  acoes: {
    CRUZAR: {
      descricao: "Cruza estoque, vendas e preços para achar oportunidades",
      async executar(input, ctx) {
        const est = await ctx.usar("ler_estoque", {});
        const { vendas: vs, evidencia } = await vendas(ctx);
        const vendidosPorCod = new Map();
        for (const v of vs) vendidosPorCod.set(v.produto?.cod, (vendidosPorCod.get(v.produto?.cod) || 0) + 1);
        const sinais = [];
        for (const e of est.saida.dados) {
          const vendidas = vendidosPorCod.get(e.cod) || 0;
          if (e.qtd >= 3 && vendidas === 0) sinais.push({ cod: e.cod, produto: e.short, regra: "estoque alto + nenhuma venda", sugestao: "promoção ou revisão de preço" });
          if (e.qtd === 0 && vendidas >= 2) sinais.push({ cod: e.cod, produto: e.short, regra: "demanda + estoque zerado", sugestao: "avaliar compra" });
        }
        return {
          resumo: `${sinais.length} sinal(is) encontrado(s).`,
          metricas: [m("sinais", sinais.length, "sinais", "regras estoque × vendas registradas")],
          itens: sinais,
          recomendacoes: sinais.map((s) => recomendacao({ acao: s.sugestao, motivo: s.regra, dados: s, ev: evidencia, metodo: "regra cruzada estoque × vendas", resultado: s.cod, limitacoes: ["sem data de entrada e sem preço de mercado; confirmar antes de agir"] })),
          limitacoes: vs.length ? [] : ["sem vendas registradas, toda regra de demanda fica sem base"],
          dados_insuficientes: vs.length === 0,
        };
      },
    },
  },
};

export const ESPECIALISTAS = [
  AGENTE_01_COMPRAS, AGENTE_02_MERCADO, AGENTE_03_ESTOQUE, AGENTE_04_PRECIFICACAO, AGENTE_05_VENDAS,
  AGENTE_06_FINANCEIRO, AGENTE_07_CREDIARIO, AGENTE_08_GARANTIAS, AGENTE_09_DEMANDA, AGENTE_10_INTELIGENCIA,
];
