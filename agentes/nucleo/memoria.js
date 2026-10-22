// agentes/nucleo/memoria.js — memória persistente dos agentes, independente da conversa.
//
// Guarda conhecimento (regras comerciais, decisões, resultados de análise, fornecedores, erros,
// procedimentos, alterações, testes) com índice por palavra-chave, assunto, agente, data, tarefa,
// aparelho e tipo de operação. A busca usa um índice invertido: só os documentos candidatos são lidos.
//
// Dados transacionais (estoque, preço, venda, valores financeiros) NÃO são copiados para cá:
// a memória guarda a REFERÊNCIA ao registro oficial (`refs: [{ tabela, id }]`).

export const TIPOS_MEMORIA = [
  "arquitetura", "regra_comercial", "decisao", "analise", "referencia",
  "fornecedor", "erro", "procedimento", "alteracao", "teste",
];

const VAZIAS = new Set("a o os as de da do das dos e em no na nos nas um uma uns umas para por com sem que se ao aos à às é ou mais menos meu minha seu sua".split(" "));

export function termos(texto) {
  return [...new Set(
    String(texto || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !VAZIAS.has(t)),
  )];
}

export class Memoria {
  constructor(armazem, { relogio = () => new Date() } = {}) {
    this.armazem = armazem;
    this.relogio = relogio;
  }

  salvar({ tipo, assunto, texto, agente = null, task_id = null, aparelho_id = null, operacao = null, palavras = [], refs = [], valido_ate = null }) {
    if (!TIPOS_MEMORIA.includes(tipo)) throw new Error(`tipo de memória inválido: ${tipo}`);
    if (!assunto || !texto) throw new Error("memória precisa de assunto e texto");
    const id = this.armazem.proximoId("MEM");
    const doc = {
      id, tipo, assunto, texto, agente, task_id, aparelho_id, operacao, refs, valido_ate,
      palavras: [...new Set([...palavras.map((p) => p.toLowerCase()), ...termos(assunto)])],
      criado_em: this.relogio().toISOString(),
    };
    this.armazem.inserir("memoria", id, doc);
    for (const t of new Set([...termos(assunto), ...termos(texto), ...doc.palavras.flatMap(termos)])) {
      const chave = "t:" + t;
      if (this.armazem.obter("memoria_indice", chave)) this.armazem.atualizar("memoria_indice", chave, (e) => ({ ...e, ids: [...e.ids, id] }));
      else this.armazem.inserir("memoria_indice", chave, { ids: [id] });
    }
    return doc;
  }

  // Busca contextual: filtros exatos + relevância por palavras-chave. Devolve só os `limite` melhores.
  buscar({ texto = "", tipo, assunto, agente, task_id, aparelho_id, operacao, de, ate, limite = 5, incluirVencidas = false } = {}) {
    const ts = termos(texto);
    let candidatos;
    if (ts.length) {
      const contagem = new Map();
      for (const t of ts) for (const id of this.armazem.obter("memoria_indice", "t:" + t)?.ids || []) contagem.set(id, (contagem.get(id) || 0) + 1);
      candidatos = [...contagem.entries()].map(([id, n]) => ({ doc: this.armazem.obter("memoria", id), n }));
    } else {
      candidatos = this.armazem.listar("memoria").map((doc) => ({ doc, n: 0 }));
    }
    const hoje = this.relogio().toISOString();
    return candidatos
      .filter(({ doc }) =>
        (!tipo || doc.tipo === tipo) &&
        (!assunto || doc.assunto.toLowerCase().includes(assunto.toLowerCase())) &&
        (!agente || doc.agente === agente) &&
        (!task_id || doc.task_id === task_id) &&
        (!aparelho_id || doc.aparelho_id === aparelho_id) &&
        (!operacao || doc.operacao === operacao) &&
        (!de || doc.criado_em >= de) &&
        (!ate || doc.criado_em <= ate) &&
        (incluirVencidas || !doc.valido_ate || doc.valido_ate >= hoje))
      .sort((a, b) => b.n - a.n || b.doc.criado_em.localeCompare(a.doc.criado_em))
      .slice(0, limite)
      .map(({ doc, n }) => ({ ...doc, relevancia: ts.length ? n / ts.length : null }));
  }
}
