// agentes/nucleo/ferramentas.js — registro de ferramentas com contrato, nível e agentes autorizados.
// É a única porta dos agentes para os dados: nenhum agente acessa o banco diretamente.

import { NIVEL } from "./permissoes.js";

// Validador mínimo de contrato (sem dependências).
// Esquema: { tipo: "objeto"|"lista"|"texto"|"numero"|"inteiro"|"booleano"|"data", obrigatorio, min, max, valores, campos, item }
export function validar(esquema, valor, caminho = "valor") {
  const erros = [];
  const v = (e, x, c) => {
    if (x === undefined || x === null) {
      if (e.obrigatorio) erros.push(`${c} é obrigatório`);
      return;
    }
    switch (e.tipo) {
      case "objeto":
        if (typeof x !== "object" || Array.isArray(x)) return erros.push(`${c} precisa ser objeto`);
        for (const [k, sub] of Object.entries(e.campos || {})) v(sub, x[k], `${c}.${k}`);
        if (e.fechado) for (const k of Object.keys(x)) if (!(k in (e.campos || {}))) erros.push(`${c}.${k} não é permitido`);
        break;
      case "lista":
        if (!Array.isArray(x)) return erros.push(`${c} precisa ser lista`);
        if (e.item) x.forEach((it, i) => v(e.item, it, `${c}[${i}]`));
        break;
      case "texto":
        if (typeof x !== "string") return erros.push(`${c} precisa ser texto`);
        if (e.valores && !e.valores.includes(x)) erros.push(`${c} precisa ser um de: ${e.valores.join(", ")}`);
        break;
      case "data":
        if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) erros.push(`${c} precisa ser data AAAA-MM-DD`);
        break;
      case "inteiro":
      case "numero":
        if (typeof x !== "number" || !Number.isFinite(x)) return erros.push(`${c} precisa ser número`);
        if (e.tipo === "inteiro" && !Number.isInteger(x)) erros.push(`${c} precisa ser inteiro`);
        if (e.min != null && x < e.min) erros.push(`${c} precisa ser ≥ ${e.min}`);
        if (e.max != null && x > e.max) erros.push(`${c} precisa ser ≤ ${e.max}`);
        break;
      case "booleano":
        if (typeof x !== "boolean") erros.push(`${c} precisa ser verdadeiro/falso`);
        break;
    }
  };
  v(esquema, valor, caminho);
  return erros;
}

export class ErroFerramenta extends Error {
  constructor(codigo, mensagem) {
    super(mensagem);
    this.codigo = codigo;
  }
}

export class Ferramentas {
  constructor({ aprovacoes, auditoria = null, relogio = () => new Date() }) {
    this.aprovacoes = aprovacoes;
    this.auditoria = auditoria;
    this.relogio = relogio;
    this.registro = new Map();
  }

  registrar({ nome, descricao, nivel = NIVEL.AUTONOMO, agentes, entrada, saida, executar }) {
    if (this.registro.has(nome)) throw new Error(`ferramenta ${nome} já registrada`);
    if (!Array.isArray(agentes) || !agentes.length) throw new Error(`ferramenta ${nome} precisa da lista de agentes autorizados`);
    this.registro.set(nome, { nome, descricao, nivel, agentes, entrada, saida, executar });
  }

  catalogo(agente = null) {
    return [...this.registro.values()]
      .filter((f) => !agente || f.agentes.includes(agente) || f.agentes.includes("*"))
      .map(({ nome, descricao, nivel }) => ({ nome, descricao, nivel }));
  }

  nivel(nome) {
    return this.registro.get(nome)?.nivel ?? null;
  }

  // contexto: { agente, task_id, aprovacao_id }
  async executar(nome, input, contexto) {
    const f = this.registro.get(nome);
    const audit = (acao, detalhes) => this.auditoria?.registrar({ ator: contexto?.agente || "?", acao, task_id: contexto?.task_id || null, detalhes: { ferramenta: nome, ...detalhes } });
    if (!f) throw new ErroFerramenta("NAO_EXISTE", `ferramenta ${nome} não existe`);
    if (!contexto?.agente || !(f.agentes.includes(contexto.agente) || f.agentes.includes("*"))) {
      audit("FERRAMENTA_NEGADA", { motivo: "agente não autorizado" });
      throw new ErroFerramenta("SEM_PERMISSAO", `${contexto?.agente} não pode usar ${nome}`);
    }
    const errosEntrada = f.entrada ? validar(f.entrada, input, "entrada") : [];
    if (errosEntrada.length) throw new ErroFerramenta("ENTRADA_INVALIDA", errosEntrada.join("; "));
    if (f.nivel >= NIVEL.APROVACAO) {
      if (!contexto.aprovacao_id) {
        audit("FERRAMENTA_BLOQUEADA", { motivo: "sem aprovação", nivel: f.nivel });
        throw new ErroFerramenta("PRECISA_APROVACAO", `${nome} é nível ${f.nivel} e precisa de aprovação do proprietário`);
      }
      this.aprovacoes.consumir(contexto.aprovacao_id, { ferramenta: nome, input, task_id: contexto.task_id });
    }
    const inicio = this.relogio().toISOString();
    const saida = await f.executar(input, contexto);
    const errosSaida = f.saida ? validar(f.saida, saida, "saida") : [];
    if (errosSaida.length) throw new ErroFerramenta("SAIDA_INVALIDA", errosSaida.join("; "));
    const evidencia = { ferramenta: nome, nivel: f.nivel, executado_em: inicio, fonte: saida?.fonte || null, consultado_em: saida?.consultado_em || inicio, registros: saida?.registros_usados || null };
    audit("FERRAMENTA_EXECUTADA", { nivel: f.nivel, aprovacao_id: contexto.aprovacao_id || null });
    return { saida, evidencia };
  }
}
