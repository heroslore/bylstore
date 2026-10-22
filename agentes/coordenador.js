// agentes/coordenador.js — Agente 00, Coordenador Geral.
//
// COORDENADOR → AGENTES ESPECIALISTAS → AUDITOR → COORDENADOR → EXECUÇÃO OU APROVAÇÃO
//
// Interpreta o pedido, monta o plano, cria as tarefas na fila (sem duplicar), roda em paralelo o que é
// independente, manda cada resultado ao Auditor (até 2 rodadas de correção), consolida, aponta conflitos
// e pede aprovação do proprietário para operações de nível 2 e 3.

import { ArmazemMemoria } from "./nucleo/armazem.js";
import { Auditoria } from "./nucleo/auditoria.js";
import { Fila, ESTADOS, chaveIdempotencia } from "./nucleo/fila.js";
import { Aprovacoes, NIVEL } from "./nucleo/permissoes.js";
import { Ferramentas } from "./nucleo/ferramentas.js";
import { Memoria, termos } from "./nucleo/memoria.js";
import { registrarFerramentasDeDados } from "./ferramentas/dados.js";
import { ESPECIALISTAS } from "./especialistas.js";
import { AUDITOR, auditar, conflitos } from "./auditor.js";
import { hojeLocal } from "../core/calculos.js";

export const COORDENADOR = "AGENTE_00_COORDENADOR";

const NUMEROS = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };

// Roteador por regras: palavras do pedido → ações do catálogo.
const ROTAS = [
  [/estoque|parad|encalh|zerad|reposic|inconsist|duplic/, "AGENTE_03_ESTOQUE", "RESUMO_ESTOQUE"],
  [/preco|precific|margem|markup|rentab|desconto/, "AGENTE_04_PRECIFICACAO", "SIMULAR_PRECOS"],
  [/venda|vendid|faturament|ticket/, "AGENTE_05_VENDAS", "RESUMO_VENDAS"],
  [/lucr|financeir|caixa|capital|despesa/, "AGENTE_06_FINANCEIRO", "RENTABILIDADE"],
  [/parcela|crediario|boleto|atras|inadimpl|cobranc|receb/, "AGENTE_07_CREDIARIO", "PARCELAS"],
  [/compra|comprar|fornecedor/, "AGENTE_01_COMPRAS", "ANALISAR_COMPRA"],
  [/mercado|concorr/, "AGENTE_02_MERCADO", "PESQUISAR_PRECOS"],
  [/garantia|defeito|manutenc|reparo/, "AGENTE_08_GARANTIAS", "RESUMO_GARANTIAS"],
  [/previs|demanda|tendenc|sazonal/, "AGENTE_09_DEMANDA", "PREVER_DEMANDA"],
  [/oportunidad|promoc|cruz/, "AGENTE_10_INTELIGENCIA", "CRUZAR"],
];
const GERAL = /relatorio geral|tudo|visao geral|resumo geral|panorama|gerencial/;

export function rotearPorRegras(texto) {
  const t = termos(texto).join(" ");
  const bruto = String(texto).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  let passos = ROTAS.filter(([re]) => re.test(t) || re.test(bruto)).map(([, agent, action]) => ({ agent, action, input: {} }));
  if (GERAL.test(bruto)) {
    passos = ["AGENTE_03_ESTOQUE.RESUMO_ESTOQUE", "AGENTE_04_PRECIFICACAO.SIMULAR_PRECOS", "AGENTE_05_VENDAS.RESUMO_VENDAS", "AGENTE_06_FINANCEIRO.RENTABILIDADE", "AGENTE_07_CREDIARIO.PARCELAS", "AGENTE_10_INTELIGENCIA.CRUZAR"]
      .map((s) => ({ agent: s.split(".")[0], action: s.split(".")[1], input: {} }));
  }
  const top = bruto.match(/\b(\d{1,2}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\b\s+(aparelhos|produtos|modelos|itens|piores|melhores)/);
  if (top) for (const p of passos) if (p.action === "SIMULAR_PRECOS") p.input.top = NUMEROS[top[1]] || parseInt(top[1]);
  return passos;
}

export class Coordenador {
  constructor({ armazem = new ArmazemMemoria(), fonte, relogio = () => new Date(), planejadorIA = null, maxRodadasCorrecao = 2, maxTentativas = 3, especialistas = ESPECIALISTAS } = {}) {
    if (!fonte) throw new Error("coordenador precisa de uma fonte de dados");
    this.relogio = relogio;
    this.armazem = armazem;
    this.auditoria = new Auditoria(armazem, relogio);
    this.fila = new Fila(armazem, { auditoria: this.auditoria, relogio, maxTentativas });
    this.aprovacoes = new Aprovacoes(armazem, { auditoria: this.auditoria, relogio });
    this.ferramentas = new Ferramentas({ aprovacoes: this.aprovacoes, auditoria: this.auditoria, relogio });
    this.memoria = new Memoria(armazem, { relogio });
    this.planejadorIA = planejadorIA;
    this.maxRodadas = maxRodadasCorrecao;
    this.agentes = new Map(especialistas.map((a) => [a.id, a]));
    registrarFerramentasDeDados(this.ferramentas, fonte, relogio);
  }

  catalogo() {
    return [...this.agentes.values()].map((a) => ({ id: a.id, nome: a.nome, acoes: Object.entries(a.acoes).map(([acao, x]) => ({ acao, descricao: x.descricao })) }));
  }

  _validarPasso(p) {
    const a = this.agentes.get(p.agent);
    return !!a && !!a.acoes[p.action];
  }

  async interpretar(texto) {
    if (this.planejadorIA) {
      try {
        const r = await this.planejadorIA(texto, this.catalogo());
        const passos = (r.passos || []).filter((p) => this._validarPasso(p)).map((p) => ({ agent: p.agent, action: p.action, input: p.top ? { top: p.top } : {} }));
        if (passos.length) return { origem: "ia", entendimento: r.entendimento, passos };
      } catch (e) {
        this.auditoria.registrar({ ator: COORDENADOR, acao: "IA_INDISPONIVEL", detalhes: { erro: e.message } });
      }
    }
    return { origem: "regras", entendimento: null, passos: rotearPorRegras(texto) };
  }

  // Pedido do administrador em linguagem natural (ou plano pronto). Devolve o relatório consolidado.
  async pedido(texto, { plano = null, solicitante = "administrador" } = {}) {
    const interp = plano ? { origem: "plano", passos: plano } : await this.interpretar(texto);
    if (!interp.passos.length) {
      return { status: "NAO_ENTENDIDO", mensagem: "Não identifiquei o que analisar. Exemplos: estoque, preços, parcelas atrasadas, vendas, lucro.", capacidades: this.catalogo() };
    }
    const pai = this.fila.criar({
      agent: COORDENADOR, action: "ATENDER_PEDIDO", input: { texto, plano: interp.passos, em: this.relogio().toISOString() }, criado_por: solicitante,
    });
    this.fila.iniciar(pai.task_id, COORDENADOR);
    const filhas = [];
    for (const p of interp.passos) {
      const deps = (p.depende || []).map((i) => filhas[i]?.task_id).filter(Boolean);
      filhas.push(this.fila.criar({
        agent: p.agent, action: p.action, input: p.input || {}, parent_id: pai.task_id, depends_on: deps,
        idempotency_key: chaveIdempotencia(p.agent, p.action, { ...p.input, pedido: pai.task_id }),
      }));
    }
    await this.processar((t) => t.parent_id === pai.task_id);
    return this._consolidar(pai.task_id, interp);
  }

  // Roda tudo que estiver pronto, em rodadas: tarefas independentes da mesma rodada rodam em paralelo.
  async processar(filtro = () => true) {
    this.fila.recuperar(COORDENADOR);
    for (let rodada = 0; rodada < 50; rodada++) {
      const prontas = this.fila.prontas(filtro).filter((t) => this.agentes.has(t.agent));
      if (!prontas.length) break;
      await Promise.all(prontas.map((t) => this._executar(t.task_id)));
    }
  }

  _contexto(agente, task_id, evidencias) {
    return {
      agente,
      task_id,
      hoje: () => hojeLocal(this.relogio()),
      memoria: this.memoria,
      ferramentas: this.ferramentas,
      usar: async (nome, input) => {
        const r = await this.ferramentas.executar(nome, input, { agente, task_id });
        evidencias.push(r.evidencia);
        return r;
      },
    };
  }

  async _executar(task_id) {
    const t = this.fila.iniciar(task_id, COORDENADOR);
    if (!t) return;
    const agente = this.agentes.get(t.agent);
    const acao = agente.acoes[t.action];
    const evidencias = [];
    try {
      const input = t.revisao ? { ...t.input, correcao: t.revisao.problemas } : t.input;
      const result = await acao.executar(input, this._contexto(t.agent, task_id, evidencias));
      evidencias.push({ tipo: "execucao_agente", agente: t.agent, acao: t.action, executado_em: this.relogio().toISOString(), tentativa: t.tentativas });
      this.fila.enviarParaRevisao(task_id, t.agent, { result, evidence: evidencias });
    } catch (e) {
      this.fila.falhar(task_id, t.agent, e);
      this.memoria.salvar({ tipo: "erro", assunto: `falha ${t.agent} ${t.action}`, texto: String(e.message), agente: t.agent, task_id, operacao: t.action });
      return;
    }
    await this._revisar(task_id, acao);
  }

  async _revisar(task_id, acao) {
    const t = this.fila.obter(task_id);
    const ctxAuditor = this._contexto(AUDITOR.id, task_id, []);
    const parecer = await auditar(t, acao, ctxAuditor);
    if (parecer.aprovado) {
      if (t.requires_approval) {
        this.fila.mover(task_id, ESTADOS.AGUARDANDO_APROVACAO, AUDITOR.id, { revisao: { ...parecer, rodada: t.rodada_correcao } });
      } else {
        this.fila.concluir(task_id, AUDITOR.id, { revisao: { ...parecer, rodada: t.rodada_correcao } });
      }
      return;
    }
    if (t.rodada_correcao < this.maxRodadas) {
      // Devolve ao agente responsável com a justificativa. A correção não gasta tentativa de falha.
      this.fila.mover(task_id, ESTADOS.PENDENTE, AUDITOR.id, {
        revisao: { ...parecer, rodada: t.rodada_correcao + 1 }, rodada_correcao: t.rodada_correcao + 1, tentativas: Math.max(0, t.tentativas - 1),
      });
      return;
    }
    const erro = `reprovada pelo auditor após ${this.maxRodadas} rodadas de correção: ${parecer.problemas.join("; ")}`;
    this.fila.mover(task_id, ESTADOS.FALHOU, COORDENADOR, { revisao: parecer, error: erro });
    this.memoria.salvar({ tipo: "erro", assunto: `reprovação ${t.agent} ${t.action}`, texto: erro, agente: t.agent, task_id, operacao: t.action });
  }

  _consolidar(paiId, interp) {
    const filhas = this.fila.listar((t) => t.parent_id === paiId);
    const prontas = filhas.filter((t) => t.status === ESTADOS.CONCLUIDA);
    const relatorio = {
      pedido: paiId,
      interpretacao: interp.origem,
      entendimento: interp.entendimento || null,
      gerado_em: this.relogio().toISOString(),
      resultados: filhas.map((t) => ({
        task_id: t.task_id, agente: t.agent, acao: t.action, status: t.status,
        resumo: t.result?.resumo ?? null, metricas: t.result?.metricas ?? [], itens: t.result?.itens ?? null,
        menor_rentabilidade: t.result?.menor_rentabilidade, recomendacoes: t.result?.recomendacoes ?? [],
        limitacoes: t.result?.limitacoes ?? [], dados_insuficientes: !!t.result?.dados_insuficientes,
        auditoria: t.revisao ? { aprovado: t.revisao.aprovado, problemas: t.revisao.problemas, rodada: t.revisao.rodada } : null,
        erro: t.error, fontes: (t.evidence || []).filter((e) => e.ferramenta).map((e) => ({ ferramenta: e.ferramenta, fonte: e.fonte, consultado_em: e.consultado_em })),
      })),
      conflitos: conflitos(prontas),
      falhas: filhas.filter((t) => t.status === ESTADOS.FALHOU).map((t) => ({ task_id: t.task_id, agente: t.agent, erro: t.error })),
    };
    const todasFinais = filhas.every((t) => [ESTADOS.CONCLUIDA, ESTADOS.FALHOU, ESTADOS.CANCELADA].includes(t.status));
    if (todasFinais) {
      const evid = [{ tipo: "consolidacao", tarefas: filhas.map((t) => `${t.task_id}:${t.status}`), em: relatorio.gerado_em }];
      if (relatorio.falhas.length === filhas.length) this.fila.mover(paiId, ESTADOS.FALHOU, COORDENADOR, { error: "todas as tarefas falharam" });
      else this.fila.concluir(paiId, COORDENADOR, { result: { resumo: relatorio.resultados.map((r) => r.resumo).filter(Boolean) }, evidence: evid });
    }
    relatorio.status = this.fila.obter(paiId).status;
    this.memoria.salvar({
      tipo: "analise", assunto: `pedido ${paiId}`, texto: [interp.entendimento, ...relatorio.resultados.map((r) => `${r.agente} ${r.acao} ${r.status}`)].filter(Boolean).join(" | "),
      agente: COORDENADOR, task_id: paiId, operacao: "ATENDER_PEDIDO", refs: filhas.map((t) => ({ tabela: "agente_tarefas", id: t.task_id })),
    });
    return relatorio;
  }

  // ── Operações de escrita (nível 2 e 3): nunca executam sem aprovação do proprietário ──
  solicitarOperacao({ agente, ferramenta, input, resumo }) {
    const nivel = this.ferramentas.nivel(ferramenta);
    if (nivel == null) throw new Error(`ferramenta ${ferramenta} não existe`);
    if (nivel < NIVEL.APROVACAO) throw new Error(`${ferramenta} é nível 1; use um pedido de análise`);
    const t = this.fila.criar({ agent: agente, action: "OPERACAO:" + ferramenta, input, requires_approval: true });
    if (t.duplicada) return { tarefa: t, aprovacao: this.aprovacoes.pendentes().find((a) => a.task_id === t.task_id) || null, duplicada: true };
    this.fila.iniciar(t.task_id, COORDENADOR);
    this.fila.enviarParaRevisao(t.task_id, agente, { result: { resumo, operacao: ferramenta, input }, evidence: [{ tipo: "pedido_operacao", agente, em: this.relogio().toISOString() }] });
    const autorizado = this.ferramentas.catalogo(agente).some((f) => f.nome === ferramenta);
    if (!autorizado) {
      this.fila.mover(t.task_id, ESTADOS.FALHOU, AUDITOR.id, { error: `${agente} não tem permissão para ${ferramenta}` });
      return { tarefa: this.fila.obter(t.task_id), aprovacao: null };
    }
    this.fila.mover(t.task_id, ESTADOS.AGUARDANDO_APROVACAO, AUDITOR.id, { revisao: { aprovado: true, problemas: [] } });
    const ap = this.aprovacoes.solicitar({ task_id: t.task_id, ferramenta, nivel, input, resumo, solicitado_por: agente });
    return { tarefa: this.fila.obter(t.task_id), aprovacao: ap };
  }

  async executarAprovada(task_id, aprovacao_id) {
    const t = this.fila.obter(task_id);
    if (t.status !== ESTADOS.AGUARDANDO_APROVACAO) throw new Error(`tarefa ${task_id} está ${t.status}`);
    const ferramenta = t.action.replace(/^OPERACAO:/, "");
    const ap = this.armazem.obter("aprovacoes", aprovacao_id);
    if (!ap || ap.status !== "APROVADA") throw new Error("operação sem aprovação do proprietário");
    this.fila.mover(task_id, ESTADOS.EM_EXECUCAO, COORDENADOR, {});
    try {
      const { saida, evidencia } = await this.ferramentas.executar(ferramenta, t.input, { agente: t.agent, task_id, aprovacao_id });
      return this.fila.concluir(task_id, COORDENADOR, { result: { ...t.result, executado: saida.dados }, evidence: [...t.evidence, { ...evidencia, aprovacao_id }] });
    } catch (e) {
      this.fila.mover(task_id, ESTADOS.FALHOU, COORDENADOR, { error: e.message });
      throw e;
    }
  }

  // Visão para a Central de Inteligência.
  estado() {
    const tarefas = this.fila.listar();
    const porAgente = {};
    for (const a of [COORDENADOR, ...this.agentes.keys(), AUDITOR.id]) porAgente[a] = { em_execucao: 0, concluidas: 0, falhas: 0 };
    for (const t of tarefas) {
      const c = porAgente[t.agent] || (porAgente[t.agent] = { em_execucao: 0, concluidas: 0, falhas: 0 });
      if (t.status === ESTADOS.EM_EXECUCAO) c.em_execucao++;
      if (t.status === ESTADOS.CONCLUIDA) c.concluidas++;
      if (t.status === ESTADOS.FALHOU) c.falhas++;
    }
    return {
      agentes: [{ id: COORDENADOR, nome: "Coordenador Geral" }, ...this.catalogo().map(({ id, nome }) => ({ id, nome })), { id: AUDITOR.id, nome: AUDITOR.nome }]
        .map((a) => ({ ...a, ...porAgente[a.id], estado: porAgente[a.id].em_execucao ? "EM_EXECUCAO" : "LIVRE" })),
      tarefas_abertas: tarefas.filter((t) => ![ESTADOS.CONCLUIDA, ESTADOS.FALHOU, ESTADOS.CANCELADA].includes(t.status)),
      aprovacoes_pendentes: this.aprovacoes.pendentes(),
      erros: tarefas.filter((t) => t.status === ESTADOS.FALHOU).map((t) => ({ task_id: t.task_id, agente: t.agent, erro: t.error })),
      historico: this.auditoria.listar().slice(-50),
      trilha_integra: this.auditoria.verificar().ok,
    };
  }
}
