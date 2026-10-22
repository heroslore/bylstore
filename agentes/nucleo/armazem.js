// agentes/nucleo/armazem.js — persistência da camada de agentes (tarefas, memória, auditoria, aprovações).
// Não guarda dados transacionais do negócio: estoque, vendas e preços continuam no banco do programa.
// Duas implementações com a mesma interface:
//   ArmazemMemoria  — testes e simulações
//   ArmazemArquivo  — grava em um arquivo JSON (troca atômica), sobrevive a reinício do processo
// Em produção entra o adaptador Supabase (Etapa 5), com as tabelas de supabase/migracoes/001_agentes.sql.

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const clonar = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export class ArmazemMemoria {
  constructor(estado = {}) {
    this.dados = clonar(estado.dados || {});
    this.contadores = { ...(estado.contadores || {}) };
  }
  _col(nome) {
    return (this.dados[nome] ||= {});
  }
  proximoId(prefixo) {
    const n = (this.contadores[prefixo] = (this.contadores[prefixo] || 0) + 1);
    this._salvar();
    return `${prefixo}-${String(n).padStart(4, "0")}`;
  }
  inserir(colecao, id, doc) {
    const col = this._col(colecao);
    if (col[id]) throw new Error(`${colecao}/${id} já existe`);
    col[id] = clonar(doc);
    this._salvar();
    return clonar(col[id]);
  }
  obter(colecao, id) {
    return clonar(this._col(colecao)[id]) ?? null;
  }
  // Atualização condicional: `se` é uma função sobre o documento atual (controle de concorrência).
  atualizar(colecao, id, alterar, se = null) {
    const col = this._col(colecao);
    const atual = col[id];
    if (!atual) throw new Error(`${colecao}/${id} não existe`);
    if (se && !se(clonar(atual))) return null;
    const novo = alterar(clonar(atual));
    col[id] = clonar(novo);
    this._salvar();
    return clonar(novo);
  }
  listar(colecao, filtro = () => true) {
    return Object.values(this._col(colecao)).map(clonar).filter(filtro);
  }
  _salvar() {}
}

export class ArmazemArquivo extends ArmazemMemoria {
  constructor(caminho) {
    const estado = existsSync(caminho) ? JSON.parse(readFileSync(caminho, "utf8")) : {};
    super(estado);
    this.caminho = caminho;
    mkdirSync(dirname(caminho), { recursive: true });
  }
  _salvar() {
    if (!this.caminho) return;
    const tmp = this.caminho + ".parcial";
    writeFileSync(tmp, JSON.stringify({ dados: this.dados, contadores: this.contadores }));
    renameSync(tmp, this.caminho);
  }
}
