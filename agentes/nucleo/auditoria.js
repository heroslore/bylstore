// agentes/nucleo/auditoria.js — trilha de auditoria somente-acréscimo, encadeada por hash.
// Cada registro guarda o hash do anterior; `verificar()` detecta alteração ou remoção no meio da trilha.

import { createHash } from "node:crypto";

export class Auditoria {
  constructor(armazem, relogio = () => new Date()) {
    this.armazem = armazem;
    this.relogio = relogio;
  }
  registrar({ ator, acao, task_id = null, detalhes = {} }) {
    const anteriores = this.armazem.listar("auditoria");
    const anterior = anteriores.sort((a, b) => a.seq - b.seq).at(-1);
    const reg = {
      seq: (anterior?.seq || 0) + 1,
      em: this.relogio().toISOString(),
      ator,
      acao,
      task_id,
      detalhes,
      hash_anterior: anterior?.hash || null,
    };
    reg.hash = hashDe(reg);
    this.armazem.inserir("auditoria", String(reg.seq).padStart(8, "0"), reg);
    return reg;
  }
  listar(filtro = {}) {
    return this.armazem
      .listar("auditoria", (r) => Object.entries(filtro).every(([k, v]) => r[k] === v))
      .sort((a, b) => a.seq - b.seq);
  }
  verificar() {
    let anterior = null;
    for (const r of this.listar()) {
      if (r.hash_anterior !== (anterior?.hash || null)) return { ok: false, seq: r.seq, motivo: "corrente quebrada" };
      const { hash, ...resto } = r;
      if (hashDe(resto) !== hash) return { ok: false, seq: r.seq, motivo: "registro alterado" };
      if (anterior && r.seq !== anterior.seq + 1) return { ok: false, seq: r.seq, motivo: "registro removido" };
      anterior = r;
    }
    return { ok: true };
  }
}

function hashDe(reg) {
  const { hash, ...resto } = reg;
  return createHash("sha256").update(JSON.stringify(resto)).digest("hex");
}
