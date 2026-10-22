// agentes/nucleo/llm.js — interpretação de pedidos em linguagem natural com a API da Anthropic.
// Mesmo padrão do byl-whatsapp (fetch direto, chave só no ambiente), sem bibliotecas novas.
// A IA só escolhe QUAIS agentes e ações rodar, a partir do catálogo; ela não calcula nem inventa números.
// Sem ANTHROPIC_API_KEY, ou em qualquer erro, o coordenador usa o roteador por regras.

const URL_API = "https://api.anthropic.com/v1/messages";

export function criarPlanejadorIA({ chave = process.env.ANTHROPIC_API_KEY, modelo = process.env.CLAUDE_MODEL || "claude-opus-5-5", fetchFn = fetch } = {}) {
  if (!chave) return null;
  return async function planejar(texto, catalogo) {
    const opcoes = catalogo.flatMap((a) => a.acoes.map((x) => `${a.id}.${x.acao}: ${x.descricao}`));
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["passos", "entendimento"],
      properties: {
        entendimento: { type: "string" },
        passos: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["agent", "action"],
            properties: { agent: { type: "string" }, action: { type: "string" }, top: { type: "integer" } },
          },
        },
      },
    };
    const r = await fetchFn(URL_API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": chave,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "server-side-fallback-2026-07-01",
      },
      body: JSON.stringify({
        model: modelo,
        max_tokens: 2000,
        fallbacks: "default",
        output_config: { effort: "low", format: { type: "json_schema", schema } },
        system:
          "Você é o coordenador de agentes da BYL STORE / Heros Cell. Escolha, só entre as ações do catálogo, " +
          "as que respondem ao pedido do administrador. Não invente ações. Se nada servir, devolva passos vazio.\n\nCatálogo:\n" +
          opcoes.join("\n"),
        messages: [{ role: "user", content: texto }],
      }),
    });
    if (!r.ok) throw new Error(`Anthropic HTTP ${r.status}`);
    const resp = await r.json();
    if (resp.stop_reason === "refusal") throw new Error("pedido recusado pela IA");
    const bloco = (resp.content || []).find((b) => b.type === "text");
    if (!bloco) throw new Error("resposta da IA sem texto");
    return JSON.parse(bloco.text);
  };
}
