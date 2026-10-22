// Cliente simulado: responde conforme o papel detectado no system prompt. Registra chamadas e concorrência.
export function criarClienteMock(opcoes = {}) {
  const chamadas = []; let ativos = 0, maxAtivos = 0; let rejeicoesRestantes = opcoes.rejeicoesAuditor || 0;
  const usage = { input_tokens: 100, output_tokens: 50 };
  const tool = (name, input, id) => ({ type: "tool_use", id: id || "tu_" + Math.random().toString(36).slice(2, 8), name, input });
  return {
    chamadas, get maxAtivos() { return maxAtivos; },
    messages: {
      create: async ({ system = "", messages, tools }) => {
        ativos++; maxAtivos = Math.max(maxAtivos, ativos);
        chamadas.push({ system: system.slice(0, 60), ultimo: messages[messages.length - 1] });
        await new Promise((r) => setTimeout(r, opcoes.latenciaMs || 5));
        try {
          const ultimo = messages[messages.length - 1];
          const jaUsouFerramenta = messages.some((m) => m.role === "assistant" && Array.isArray(m.content) && m.content.some((b) => b.type === "tool_use"));
          if (system.includes('{"interpretacao"')) {
            const plano = opcoes.plano || { interpretacao: "teste", agentes: [{ id: "AGENTE_03_ESTOQUE", instrucao: "liste o estoque", dependeDe: [] }], observacao: "" };
            return { content: [{ type: "text", text: JSON.stringify(plano) }], stop_reason: "end_turn", usage };
          }
          if (system.includes('"aprovado"')) {
            if (rejeicoesRestantes > 0) { rejeicoesRestantes--; return { content: [{ type: "text", text: JSON.stringify({ aprovado: false, problemas: ["número sem evidência"], parecer: "corrija" }) }], stop_reason: "end_turn", usage }; }
            return { content: [{ type: "text", text: JSON.stringify({ aprovado: true, problemas: [], parecer: "ok" }) }], stop_reason: "end_turn", usage };
          }
          if (system.includes("Consolide")) return { content: [{ type: "text", text: "RESPOSTA FINAL CONSOLIDADA" }], stop_reason: "end_turn", usage };
          // especialista
          if (!jaUsouFerramenta) {
            const nomes = (tools || []).map((t) => t.name);
            const chave = opcoes.ferramentasPorAgente && Object.keys(opcoes.ferramentasPorAgente).find((k) => system.startsWith(k)); const quer = chave ? opcoes.ferramentasPorAgente[chave] : null;
            const usar = quer || (nomes.includes("propor_preco_lista") && opcoes.proporPreco ? [["propor_preco_lista", { modelo: "iPhone 13 128GB", preco: 1750, justificativa: "teste" }]] : [["listar_estoque", {}], ["parametros", {}]]);
            return { content: usar.map(([n, i]) => tool(n, i)), stop_reason: "tool_use", usage };
          }
          const resultados = Array.isArray(ultimo.content) ? ultimo.content.filter((b) => b.type === "tool_result") : [];
          const temErro = resultados.some((r) => r.is_error);
          const feedback = messages[0].content.includes("REVISÃO DO AUDITOR");
          return { content: [{ type: "text", text: (feedback ? "RESPOSTA CORRIGIDA. " : "RESPOSTA DO ESPECIALISTA. ") + (temErro ? "Ferramenta com erro. " : "") + "Dados: " + resultados.map((r) => String(r.content).slice(0, 80)).join(" | ") }], stop_reason: "end_turn", usage };
        } finally { ativos--; }
      },
    },
  };
}
