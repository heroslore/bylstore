// agentes/nucleo/fila.js — fila de tarefas persistente com estados, tentativas, dependências,
// prevenção de duplicidade e recuperação de tarefas interrompidas.

import { createHash } from "node:crypto";

export const ESTADOS = Object.freeze({
  PENDENTE: "PENDENTE",
  EM_EXECUCAO: "EM_EXECUCAO",
  AGUARDANDO_REVISAO: "AGUARDANDO_REVISAO",
  AGUARDANDO_APROVACAO: "AGUARDANDO_APROVACAO",
  CONCLUIDA: "CONCLUIDA",
  FALHOU: "FALHOU",
  CANCELADA: "CANCELADA",
});
const E = ESTADOS;

// Transições permitidas. Qualquer outra é recusada.
const TRANSICOES = {
  PENDENTE: [E.EM_EXECUCAO, E.CANCELADA, E.FALHOU],
  EM_EXECUCAO: [E.AGUARDANDO_REVISAO, E.PENDENTE, E.FALHOU, E.CANCELADA, E.CONCLUIDA],
  AGUARDANDO_REVISAO: [E.CONCLUIDA, E.AGUARDANDO_APROVACAO, E.PENDENTE, E.FALHOU, E.CANCELADA],
  AGUARDANDO_APROVACAO: [E.EM_EXECUCAO, E.CONCLUIDA, E.CANCELADA, E.FALHOU],
  CONCLUIDA: [],
  FALHOU: [E.PENDENTE],
  CANCELADA: [],
};
const FINAIS = new Set([E.CONCLUIDA, E.FALHOU, E.CANCELADA]);

export function chaveIdempotencia(agent, action, input) {
  return createHash("sha256").update(JSON.stringify([agent, action, ordenar(input)])).digest("hex").slice(0, 24);
}
function ordenar(v) {
  if (Array.isArray(v)) return v.map(ordenar);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenar(v[k])]));
  return v;
}

export class Fila {
  constructor(armazem, { auditoria = null, relogio = () => new Date(), prazoExecucaoMs = 5 * 60_000, maxTentativas = 3 } = {}) {
    this.armazem = armazem;
    this.auditoria = auditoria;
    this.relogio = relogio;
    this.prazoExecucaoMs = prazoExecucaoMs;
    this.maxTentativas = maxTentativas;
  }

  criar({ agent, action, input = {}, requires_approval = false, depends_on = [], parent_id = null, idempotency_key, criado_por = "AGENTE_00_COORDENADOR" }) {
    if (!agent || !action) throw new Error("tarefa precisa de agent e action");
    const chave = idempotency_key || chaveIdempotencia(agent, action, input);
    const existente = this.armazem.listar("tarefas", (t) => t.idempotency_key === chave && t.status !== E.CANCELADA && t.status !== E.FALHOU)[0];
    if (existente) {
      this._audit(criado_por, "TAREFA_DUPLICADA_EVITADA", existente.task_id, { chave });
      return { ...existente, duplicada: true };
    }
    for (const dep of depends_on) if (!this.obter(dep)) throw new Error(`dependência ${dep} não existe`);
    const agora = this.relogio().toISOString();
    const task = {
      task_id: this.armazem.proximoId("TASK"),
      agent,
      action,
      input,
      status: E.PENDENTE,
      requires_approval,
      depends_on,
      parent_id,
      idempotency_key: chave,
      tentativas: 0,
      max_tentativas: this.maxTentativas,
      rodada_correcao: 0,
      result: null,
      evidence: [],
      error: null,
      revisao: null,
      prazo_execucao: null,
      criado_em: agora,
      atualizado_em: agora,
      log: [{ em: agora, de: null, para: E.PENDENTE, por: criado_por }],
    };
    this.armazem.inserir("tarefas", task.task_id, task);
    this._audit(criado_por, "TAREFA_CRIADA", task.task_id, { agent, action });
    return task;
  }

  obter(id) {
    return this.armazem.obter("tarefas", id);
  }
  listar(filtro = () => true) {
    return this.armazem.listar("tarefas", filtro).sort((a, b) => a.task_id.localeCompare(b.task_id));
  }

  mover(id, para, por, mudancas = {}, { esperado = null } = {}) {
    const agora = this.relogio().toISOString();
    const r = this.armazem.atualizar(
      "tarefas",
      id,
      (t) => {
        if (!TRANSICOES[t.status].includes(para)) throw new Error(`transição inválida ${t.status} → ${para} (${id})`);
        return { ...t, ...mudancas, status: para, atualizado_em: agora, log: [...t.log, { em: agora, de: t.status, para, por }] };
      },
      esperado ? (t) => t.status === esperado : null,
    );
    if (r) this._audit(por, "TAREFA_" + para, id, mudancas.error ? { error: mudancas.error } : {});
    return r;
  }

  // Situação das dependências: "ok", "esperando" ou "falhou".
  dependencias(task) {
    const deps = task.depends_on.map((d) => this.obter(d));
    if (deps.some((d) => d.status === E.FALHOU || d.status === E.CANCELADA)) return "falhou";
    return deps.every((d) => d.status === E.CONCLUIDA) ? "ok" : "esperando";
  }

  // Tarefas prontas para rodar (pendentes e com dependências concluídas). Cancela as que dependem de falha.
  prontas(filtro = () => true) {
    const lista = [];
    for (const t of this.listar((t) => t.status === E.PENDENTE && filtro(t))) {
      const dep = this.dependencias(t);
      if (dep === "falhou") this.mover(t.task_id, E.CANCELADA, "AGENTE_00_COORDENADOR", { error: "dependência falhou ou foi cancelada" });
      else if (dep === "ok") lista.push(t);
    }
    return lista;
  }

  // Reserva a tarefa para execução. Só um executor consegue (atualização condicional).
  iniciar(id, por) {
    const t = this.obter(id);
    if (!t) throw new Error(`tarefa ${id} não existe`);
    if (t.tentativas >= t.max_tentativas) {
      this.mover(id, E.FALHOU, por, { error: t.error || "limite de tentativas atingido" });
      return null;
    }
    const prazo = new Date(this.relogio().getTime() + this.prazoExecucaoMs).toISOString();
    return this.mover(id, E.EM_EXECUCAO, por, { tentativas: t.tentativas + 1, prazo_execucao: prazo }, { esperado: E.PENDENTE });
  }

  enviarParaRevisao(id, por, { result, evidence }) {
    return this.mover(id, E.AGUARDANDO_REVISAO, por, { result, evidence, prazo_execucao: null });
  }

  // Concluir exige evidência da execução real.
  concluir(id, por, { result, evidence, revisao } = {}) {
    const t = this.obter(id);
    const ev = evidence ?? t.evidence;
    if (!Array.isArray(ev) || ev.length === 0) throw new Error(`tarefa ${id} não pode ser concluída sem evidência`);
    return this.mover(id, E.CONCLUIDA, por, { result: result ?? t.result, evidence: ev, prazo_execucao: null, ...(revisao ? { revisao } : {}) });
  }

  // Falha com nova tentativa automática enquanto houver tentativas; depois fica FALHOU (nunca some).
  falhar(id, por, erro) {
    const t = this.obter(id);
    const mensagem = String(erro?.message || erro);
    if (t.tentativas < t.max_tentativas && t.status === E.EM_EXECUCAO) return this.mover(id, E.PENDENTE, por, { error: mensagem, prazo_execucao: null });
    return this.mover(id, E.FALHOU, por, { error: mensagem, prazo_execucao: null });
  }

  cancelar(id, por, motivo) {
    return this.mover(id, E.CANCELADA, por, { error: motivo });
  }

  // Recuperação após interrupção: EM_EXECUCAO com prazo vencido volta para a fila.
  recuperar(por = "AGENTE_00_COORDENADOR") {
    const agora = this.relogio().toISOString();
    const recuperadas = [];
    for (const t of this.listar((t) => t.status === E.EM_EXECUCAO && t.prazo_execucao && t.prazo_execucao < agora)) {
      const r = t.tentativas < t.max_tentativas
        ? this.mover(t.task_id, E.PENDENTE, por, { error: "interrompida: prazo de execução vencido", prazo_execucao: null })
        : this.mover(t.task_id, E.FALHOU, por, { error: "interrompida e sem tentativas restantes", prazo_execucao: null });
      recuperadas.push(r);
    }
    return recuperadas;
  }

  finalizada(id) {
    return FINAIS.has(this.obter(id).status);
  }

  _audit(ator, acao, task_id, detalhes) {
    this.auditoria?.registrar({ ator, acao, task_id, detalhes });
  }
}
