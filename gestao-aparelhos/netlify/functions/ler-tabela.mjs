// Lê prints da tabela do leilão com o Claude e devolve as linhas em JSON.
// POST /api/ler-tabela  body { images: [{ media_type, data }] }  (base64, até 4 imagens)
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { json, store, senhaConfere } from "../lib/auth.mjs";

export const config = { path: "/api/ler-tabela" };

const Linha = z.object({
  modelo: z.string().describe("Modelo do aparelho como aparece na coluna Model, ex: iPhone 14 Pro Max"),
  capacidade: z.string().describe("Capacidade, ex: 128GB, 256GB, 1TB; vazio se não houver"),
  cor: z.string().describe("Cor como aparece na coluna Color; vazio se não houver"),
  grade: z.string().describe("Grade/condição, ex: DLS A+, TPS B+; vazio se não houver"),
  estoque: z.number().int().nullable().describe("Coluna Estoque/Stock, ou null"),
  quantidade: z.number().int().nullable().describe("Coluna Offer Quantity, ou null"),
  preco: z.number().describe("Preço unitário em dólares da coluna New Offer Price / Price, como número"),
});
const Tabela = z.object({ linhas: z.array(Linha) });

const MEDIA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  const st = store();
  if (!(await senhaConfere(st, req.headers.get("x-sync-key") || ""))) return json({ error: "Senha de acesso inválida." }, 401);
  const apiKey = Netlify.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "Leitura de imagem não configurada: falta a chave ANTHROPIC_API_KEY no servidor." }, 503);

  let body;
  try { body = await req.json(); } catch (e) { return json({ error: "JSON inválido." }, 400); }
  const images = Array.isArray(body && body.images) ? body.images.slice(0, 4) : [];
  if (!images.length) return json({ error: "Envie pelo menos uma imagem." }, 400);
  for (const im of images) {
    if (!im || !MEDIA.has(im.media_type) || typeof im.data !== "string" || !im.data) return json({ error: "Imagem inválida." }, 400);
    if (im.data.length > 5_000_000) return json({ error: "Imagem grande demais. Envie um print menor." }, 413);
  }

  const client = new Anthropic({ apiKey });
  const content = images.map((im) => ({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } }));
  content.push({
    type: "text",
    text: "As imagens são prints de uma planilha de leilão de iPhones com as colunas Model, Capacity, Color, Grade, Estoque, Offer Quantity e New Offer Price. " +
      "Extraia TODAS as linhas de todas as imagens, na ordem em que aparecem, sem inventar linhas e sem pular nenhuma. " +
      "Se a mesma linha aparecer repetida em duas imagens (bordas de recorte), inclua só uma vez. " +
      "Preço: converta '$233,00' para 233. Números de estoque e quantidade como inteiros.",
  });

  try {
    const response = await client.messages.parse({
      model: "claude-opus-5",
      max_tokens: 16000,
      messages: [{ role: "user", content }],
      output_config: { format: zodOutputFormat(Tabela) },
    });
    if (response.stop_reason === "refusal") return json({ error: "O modelo recusou ler esta imagem." }, 422);
    if (response.stop_reason === "max_tokens") return json({ error: "Tabela grande demais para uma leitura. Envie menos linhas por vez." }, 422);
    const parsed = response.parsed_output;
    if (!parsed || !Array.isArray(parsed.linhas)) return json({ error: "Não consegui interpretar a tabela." }, 422);
    const usage = response.usage || {};
    return json({ linhas: parsed.linhas, tokens: { entrada: usage.input_tokens || 0, saida: usage.output_tokens || 0 } });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "Chave da API da Anthropic inválida." }, 502);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "Limite da API atingido. Tente de novo em instantes." }, 503);
    if (e instanceof Anthropic.APIError) return json({ error: "Erro na API da Anthropic (" + e.status + "): " + e.message }, 502);
    return json({ error: "Falha ao ler a imagem: " + (e && e.message ? e.message : e) }, 500);
  }
};
