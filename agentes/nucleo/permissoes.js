// agentes/nucleo/permissoes.js — níveis de operação e aprovações do proprietário.
//
// Nível 1 AUTÔNOMO: consultas, análises, relatórios, alertas, recomendações, simulações.
// Nível 2 APROVAÇÃO: preço, compra, venda, ajuste financeiro, cobrança, contrato.
// Nível 3 CRÍTICO: exclusão, alteração de operação concluída, cancelamento de contrato, bloqueio, irreversível.
//
// Uma aprovação só vale se vier de um usuário humano autenticado com papel de proprietário.
// Texto produzido por agente nunca vale como aprovação. Nível 3 exige ainda digitar o código da aprovação.

import { createHash, randomBytes } from "node:crypto";

export const NIVEL = Object.freeze({ AUTONOMO: 1, APROVACAO: 2, CRITICO: 3 });

export function hashOperacao(ferramenta, input) {
  return createHash("sha256").update(JSON.stringify([ferramenta, input])).digest("hex").slice(0, 32);
}

export function ehProprietario(ator) {
  return !!ator && ator.tipo === "humano" && ator.autenticado === true && ator.papel === "proprietario" && !!ator.usuario;
}

export class Aprovacoes {
  constructor(armazem, { auditoria = null, relogio = () => new Date(), validadeMs = 24 * 3600_000 } = {}) {
    this.armazem = armazem;
    this.auditoria = auditoria;
    this.relogio = relogio;
    this.validadeMs = validadeMs;
  }

  solicitar({ task_id, ferramenta, nivel, input, resumo, solicitado_por }) {
    const aberta = this.armazem.listar("aprovacoes", (a) => a.task_id === task_id && a.ferramenta === ferramenta && a.status === "PENDENTE")[0];
    if (aberta) return aberta;
    const agora = this.relogio();
    const ap = {
      id: this.armazem.proximoId("APR"),
      task_id,
      ferramenta,
      nivel,
      operacao: hashOperacao(ferramenta, input),
      input,
      resumo,
      solicitado_por,
      status: "PENDENTE",
      codigo_confirmacao: nivel >= NIVEL.CRITICO ? randomBytes(3).toString("hex").toUpperCase() : null,
      criado_em: agora.toISOString(),
      expira_em: new Date(agora.getTime() + this.validadeMs).toISOString(),
      decidido_por: null,
      decidido_em: null,
      usada: false,
    };
    this.armazem.inserir("aprovacoes", ap.id, ap);
    this.auditoria?.registrar({ ator: solicitado_por, acao: "APROVACAO_SOLICITADA", task_id, detalhes: { id: ap.id, ferramenta, nivel } });
    return ap;
  }

  decidir(id, ator, { aprovar, confirmacao = null, motivo = null }) {
    const ap = this.armazem.obter("aprovacoes", id);
    if (!ap) throw new Error(`aprovação ${id} não existe`);
    if (!ehProprietario(ator)) {
      this.auditoria?.registrar({ ator: ator?.usuario || ator?.agente || "desconhecido", acao: "APROVACAO_RECUSADA_SEM_PERMISSAO", task_id: ap.task_id, detalhes: { id } });
      throw new Error("só o proprietário autenticado pode aprovar ou recusar");
    }
    if (ap.status !== "PENDENTE") throw new Error(`aprovação ${id} já está ${ap.status}`);
    if (this.relogio().toISOString() > ap.expira_em) {
      this.armazem.atualizar("aprovacoes", id, (a) => ({ ...a, status: "EXPIRADA" }));
      throw new Error(`aprovação ${id} expirou`);
    }
    if (aprovar && ap.nivel >= NIVEL.CRITICO && confirmacao !== ap.codigo_confirmacao) {
      throw new Error("operação crítica: digite o código de confirmação desta aprovação");
    }
    const r = this.armazem.atualizar("aprovacoes", id, (a) => ({
      ...a,
      status: aprovar ? "APROVADA" : "RECUSADA",
      decidido_por: ator.usuario,
      decidido_em: this.relogio().toISOString(),
      motivo,
    }));
    this.auditoria?.registrar({ ator: ator.usuario, acao: aprovar ? "APROVACAO_CONCEDIDA" : "APROVACAO_NEGADA", task_id: ap.task_id, detalhes: { id, motivo } });
    return r;
  }

  // Confere e consome a aprovação: mesma ferramenta, mesmo input, aprovada, não usada, não expirada.
  consumir(id, { ferramenta, input, task_id }) {
    const ap = this.armazem.obter("aprovacoes", id);
    if (!ap) throw new Error("aprovação não encontrada");
    if (ap.status !== "APROVADA") throw new Error(`aprovação ${id} está ${ap.status}`);
    if (ap.usada) throw new Error(`aprovação ${id} já foi usada`);
    if (ap.ferramenta !== ferramenta || ap.task_id !== task_id || ap.operacao !== hashOperacao(ferramenta, input)) {
      throw new Error("aprovação não corresponde a esta operação");
    }
    if (this.relogio().toISOString() > ap.expira_em) throw new Error(`aprovação ${id} expirou`);
    const r = this.armazem.atualizar("aprovacoes", id, (a) => ({ ...a, usada: true }), (a) => !a.usada);
    if (!r) throw new Error(`aprovação ${id} já foi usada`);
    return r;
  }

  pendentes() {
    return this.armazem.listar("aprovacoes", (a) => a.status === "PENDENTE");
  }
}
