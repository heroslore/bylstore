// agentes/rotinas.js — motor de automações agendadas (diária, semanal, mensal).
// Cada rotina pode ser ativada, desativada, reagendada e consultada. Só roda ações de nível 1
// (consultas e relatórios); o que precisar de escrita vira pedido de aprovação.

const ROTINAS_PADRAO = [
  {
    nome: "diaria", frequencia: "diaria", horario: "08:00", ativo: true,
    descricao: "Estoque zerado/baixo, parcelas vencidas, alertas e indicadores do dia",
    plano: [
      { agent: "AGENTE_03_ESTOQUE", action: "RESUMO_ESTOQUE" },
      { agent: "AGENTE_07_CREDIARIO", action: "PARCELAS" },
      { agent: "AGENTE_06_FINANCEIRO", action: "RENTABILIDADE" },
    ],
  },
  {
    nome: "semanal", frequencia: "semanal", dia_semana: 1, horario: "08:00", ativo: true,
    descricao: "Giro, preços, rentabilidade e oportunidades",
    plano: [
      { agent: "AGENTE_04_PRECIFICACAO", action: "SIMULAR_PRECOS" },
      { agent: "AGENTE_05_VENDAS", action: "RESUMO_VENDAS" },
      { agent: "AGENTE_10_INTELIGENCIA", action: "CRUZAR" },
      { agent: "AGENTE_01_COMPRAS", action: "ANALISAR_COMPRA" },
    ],
  },
  {
    nome: "mensal", frequencia: "mensal", dia_mes: 1, horario: "08:00", ativo: true,
    descricao: "Consolidação, indicadores financeiros, crediário e previsão",
    plano: [
      { agent: "AGENTE_05_VENDAS", action: "RESUMO_VENDAS" },
      { agent: "AGENTE_06_FINANCEIRO", action: "RENTABILIDADE" },
      { agent: "AGENTE_07_CREDIARIO", action: "PARCELAS" },
      { agent: "AGENTE_09_DEMANDA", action: "PREVER_DEMANDA" },
    ],
  },
];

// Período da rotina (para não rodar duas vezes no mesmo dia/semana/mês).
function periodo(r, d) {
  const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  if (r.frequencia === "diaria") return iso(d);
  if (r.frequencia === "mensal") return iso(d).slice(0, 7);
  const seg = new Date(d);
  seg.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return "S" + iso(seg);
}

function devida(r, d) {
  if (!r.ativo) return false;
  const [h, m] = r.horario.split(":").map(Number);
  if (d.getHours() * 60 + d.getMinutes() < h * 60 + m) return false;
  if (r.frequencia === "semanal" && d.getDay() !== r.dia_semana) return false;
  if (r.frequencia === "mensal" && d.getDate() !== r.dia_mes) return false;
  return r.ultimo_periodo !== periodo(r, d);
}

export class Rotinas {
  constructor(coordenador) {
    this.c = coordenador;
    for (const r of ROTINAS_PADRAO) if (!this.c.armazem.obter("rotinas", r.nome)) this.c.armazem.inserir("rotinas", r.nome, { ...r, ultimo_periodo: null, ultima_execucao: null });
  }
  listar() {
    return this.c.armazem.listar("rotinas");
  }
  configurar(nome, mudancas) {
    const permitidos = ["ativo", "horario", "dia_semana", "dia_mes"];
    const limpo = Object.fromEntries(Object.entries(mudancas).filter(([k]) => permitidos.includes(k)));
    const r = this.c.armazem.atualizar("rotinas", nome, (x) => ({ ...x, ...limpo }));
    this.c.auditoria.registrar({ ator: "administrador", acao: "ROTINA_CONFIGURADA", detalhes: { nome, ...limpo } });
    return r;
  }
  ativar(nome) { return this.configurar(nome, { ativo: true }); }
  desativar(nome) { return this.configurar(nome, { ativo: false }); }

  async executar(nome) {
    const r = this.c.armazem.obter("rotinas", nome);
    if (!r) throw new Error(`rotina ${nome} não existe`);
    const agora = this.c.relogio();
    const rel = await this.c.pedido(`rotina ${nome}`, { plano: r.plano.map((p) => ({ ...p, input: { rotina: nome, periodo: periodo(r, agora) } })), solicitante: "ROTINA_" + nome.toUpperCase() });
    this.c.armazem.atualizar("rotinas", nome, (x) => ({ ...x, ultimo_periodo: periodo(r, agora), ultima_execucao: { em: agora.toISOString(), pedido: rel.pedido, status: rel.status, falhas: rel.falhas.length } }));
    this.c.armazem.inserir("rotina_execucoes", rel.pedido, { rotina: nome, ...rel });
    return rel;
  }

  // Chamada pelo cron: roda as rotinas devidas agora.
  async tick() {
    const agora = this.c.relogio();
    const feitas = [];
    for (const r of this.listar()) if (devida(r, agora)) feitas.push(await this.executar(r.nome));
    return feitas;
  }

  resultados(nome, limite = 10) {
    return this.c.armazem.listar("rotina_execucoes", (x) => !nome || x.rotina === nome).sort((a, b) => b.gerado_em.localeCompare(a.gerado_em)).slice(0, limite);
  }
}
