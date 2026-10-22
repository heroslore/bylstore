// agentes/ferramentas/dados.js — acesso aos dados do programa (tabelas estoque, orcamentos, produtos_custom).
//
// FonteSupabase: SOMENTE LEITURA (GET). URL e chave vêm do ambiente, nunca do código.
// FonteFixture:  dados em memória para testes e simulações; aceita escrita para testar os fluxos de aprovação.
//
// A normalização segue o que o index.html faz em syncAll().

import { NIVEL } from "../nucleo/permissoes.js";

function normalizarEstoque(r) {
  return { cod: r.cod, nome: r.nome, short: r.short, usd: +r.usd || 0, qtd: parseInt(r.qtd) || 0, custoTotal: parseFloat(r.custo_total ?? r.custoTotal) || 0 };
}
function normalizarOrcamento(r) {
  const json = (v, d) => {
    if (typeof v === "string" && v) try { return JSON.parse(v); } catch { return d; }
    return v ?? d;
  };
  return {
    id: r.id, criado: r.criado, produto: json(r.produto, {}), custo: +r.custo || 0, venda: +r.venda || 0,
    planos: json(r.planos, {}), status: r.status, vendaData: r.venda_data ?? r.vendaData ?? null,
    planoEsc: r.plano_esc ?? r.planoEsc ?? null, entrada: r.entrada != null ? +r.entrada : null, parcelas: json(r.parcelas, null),
  };
}

// Com SUPABASE_EMAIL/SUPABASE_SENHA, entra com o usuário dos agentes (papel "leitura" no banco).
// Assim, mesmo que alguém altere este código, o banco recusa qualquer gravação feita pelos agentes.
export class FonteSupabase {
  constructor({ url = process.env.SUPABASE_URL, chave = process.env.SUPABASE_KEY, email = process.env.SUPABASE_EMAIL, senha = process.env.SUPABASE_SENHA, fetchFn = fetch } = {}) {
    if (!url || !chave) throw new Error("defina SUPABASE_URL e SUPABASE_KEY no agentes.env");
    this.url = url.replace(/\/$/, "");
    this.chave = chave;
    this.email = email;
    this.senha = senha;
    this.fetch = fetchFn;
    this.sessao = null;
    this.nome = "supabase:" + new URL(this.url).hostname.split(".")[0];
  }
  async _token() {
    if (!this.email) return this.chave;
    if (this.sessao && Date.now() < this.sessao.expira - 60_000) return this.sessao.token;
    const r = await this.fetch(`${this.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: this.chave, "content-type": "application/json" },
      body: JSON.stringify({ email: this.email, password: this.senha }),
    });
    if (!r.ok) throw new Error(`login dos agentes no Supabase falhou: HTTP ${r.status}`);
    const j = await r.json();
    this.sessao = { token: j.access_token, expira: Date.now() + (j.expires_in || 3600) * 1000 };
    return this.sessao.token;
  }
  async _get(tabela, query = "") {
    const r = await this.fetch(`${this.url}/rest/v1/${tabela}${query ? "?" + query : ""}`, {
      method: "GET",
      headers: { apikey: this.chave, Authorization: "Bearer " + (await this._token()) },
    });
    if (r.status === 401) this.sessao = null;
    if (!r.ok) throw new Error(`leitura de ${tabela} falhou: HTTP ${r.status}`);
    return r.json();
  }
  async estoque() {
    return (await this._get("estoque", "select=cod,nome,short,usd,qtd,custo_total")).map(normalizarEstoque);
  }
  async orcamentos() {
    return (await this._get("orcamentos", "select=*&order=created_at.desc")).map(normalizarOrcamento);
  }
}

export class FonteFixture {
  constructor({ estoque = [], orcamentos = [] } = {}) {
    this.nome = "fixture";
    this._estoque = estoque.map(normalizarEstoque);
    this._orcamentos = orcamentos.map(normalizarOrcamento);
    this.escritas = [];
  }
  async estoque() {
    return structuredClone(this._estoque);
  }
  async orcamentos() {
    return structuredClone(this._orcamentos);
  }
  async registrarEntrada({ cod, qtd, custoUnitario }) {
    const item = this._estoque.find((e) => e.cod === cod);
    if (!item) throw new Error(`produto ${cod} não existe`);
    item.qtd += qtd;
    item.custoTotal = Math.round((item.custoTotal + qtd * custoUnitario) * 100) / 100;
    this.escritas.push({ tipo: "entrada", cod, qtd, custoUnitario });
    return structuredClone(item);
  }
  async excluirOrcamento(id) {
    const antes = this._orcamentos.length;
    this._orcamentos = this._orcamentos.filter((o) => o.id !== id);
    this.escritas.push({ tipo: "exclusao", id });
    return antes !== this._orcamentos.length;
  }
}

const TODOS_ANALISTAS = [
  "AGENTE_01_COMPRAS", "AGENTE_03_ESTOQUE", "AGENTE_04_PRECIFICACAO", "AGENTE_05_VENDAS", "AGENTE_06_FINANCEIRO",
  "AGENTE_07_CREDIARIO", "AGENTE_09_DEMANDA", "AGENTE_10_INTELIGENCIA", "AGENTE_11_AUDITOR",
];

export function registrarFerramentasDeDados(ferramentas, fonte, relogio = () => new Date()) {
  const carimbo = (dados, ids) => ({ dados, fonte: fonte.nome, consultado_em: relogio().toISOString(), registros_usados: ids });
  const saidaLista = { tipo: "objeto", obrigatorio: true, campos: { dados: { tipo: "lista", obrigatorio: true }, fonte: { tipo: "texto", obrigatorio: true } } };

  ferramentas.registrar({
    nome: "ler_estoque",
    descricao: "Lê o estoque por produto (código, nome, US$, quantidade, custo total). Somente leitura.",
    nivel: NIVEL.AUTONOMO,
    agentes: TODOS_ANALISTAS,
    entrada: { tipo: "objeto", campos: {} },
    saida: saidaLista,
    executar: async () => {
      const e = await fonte.estoque();
      return carimbo(e, e.map((x) => "estoque:" + x.cod));
    },
  });

  ferramentas.registrar({
    nome: "ler_orcamentos",
    descricao: "Lê orçamentos e vendas parceladas com as parcelas. Somente leitura.",
    nivel: NIVEL.AUTONOMO,
    agentes: TODOS_ANALISTAS,
    entrada: { tipo: "objeto", campos: { status: { tipo: "texto", valores: ["pendente", "vendido"] } } },
    saida: saidaLista,
    executar: async ({ status } = {}) => {
      const o = (await fonte.orcamentos()).filter((x) => !status || x.status === status);
      return carimbo(o, o.map((x) => "orcamentos:" + x.id));
    },
  });

  if (fonte.registrarEntrada) {
    ferramentas.registrar({
      nome: "registrar_entrada_estoque",
      descricao: "Dá entrada de unidades no estoque (cadastro definitivo de compra).",
      nivel: NIVEL.APROVACAO,
      agentes: ["AGENTE_01_COMPRAS", "AGENTE_03_ESTOQUE"],
      entrada: { tipo: "objeto", obrigatorio: true, fechado: true, campos: {
        cod: { tipo: "texto", obrigatorio: true },
        qtd: { tipo: "inteiro", obrigatorio: true, min: 1, max: 500 },
        custoUnitario: { tipo: "numero", obrigatorio: true, min: 0.01 },
      } },
      saida: { tipo: "objeto", obrigatorio: true, campos: { dados: { tipo: "objeto", obrigatorio: true } } },
      executar: async (input) => carimbo(await fonte.registrarEntrada(input), ["estoque:" + input.cod]),
    });
  }
  if (fonte.excluirOrcamento) {
    ferramentas.registrar({
      nome: "excluir_orcamento",
      descricao: "Exclui um orçamento (irreversível).",
      nivel: NIVEL.CRITICO,
      agentes: ["AGENTE_07_CREDIARIO"],
      entrada: { tipo: "objeto", obrigatorio: true, fechado: true, campos: { id: { tipo: "texto", obrigatorio: true } } },
      saida: { tipo: "objeto", obrigatorio: true, campos: { dados: { tipo: "booleano", obrigatorio: true } } },
      executar: async ({ id }) => carimbo(await fonte.excluirOrcamento(id), ["orcamentos:" + id]),
    });
  }
}
