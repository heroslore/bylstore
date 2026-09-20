// Lê prints da tabela do leilão com o Claude e devolve a tabela em texto (TSV) para o app.
// POST /api/ler-tabela  body { images: [{ media_type, data }] }  (base64, até 4 imagens)
import Anthropic from "@anthropic-ai/sdk";
import { json, store, senhaConfere } from "../lib/auth.mjs";

export const config = { path: "/api/ler-tabela" };

const MEDIA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const HEADER = "Model\tCapacity\tColor\tGrade\tEstoque\tOffer Quantity\tNew Offer Price";

const INSTRUCOES =
  "Você transcreve prints de uma planilha de leilão de iPhones. Devolva SOMENTE a tabela em texto separado por tabulação (TSV), " +
  "com esta primeira linha de cabeçalho exatamente: " + HEADER + "\n" +
  "Regras: uma linha de saída por linha da planilha, na ordem em que aparecem, incluindo linhas repetidas (mesmo modelo, capacidade e cor são ofertas diferentes). " +
  "Não pule linhas, não invente linhas, não resuma. Se uma linha estiver cortada na borda da imagem e aparecer inteira em outra imagem, use só a inteira. " +
  "Coluna de preço: número puro em dólares, '$233,00' vira 233. Estoque e Offer Quantity como inteiros. Célula vazia fica vazia. " +
  "Sem comentários, sem markdown, sem texto antes ou depois da tabela.";

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
  content.push({ type: "text", text: "Transcreva a tabela destas " + images.length + " imagem(ns) em TSV, conforme as regras." });

  try {
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 16000,
      system: INSTRUCOES,
      messages: [{ role: "user", content }],
    });
    if (response.stop_reason === "refusal") return json({ error: "O modelo recusou ler esta imagem." }, 422);
    let texto = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    texto = texto.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "").trim();
    const linhas = texto.split(/\r?\n/).filter((l) => l.trim());
    if (!linhas.length) return json({ error: "A IA não devolveu nenhuma linha." }, 422);
    if (!/model/i.test(linhas[0])) texto = HEADER + "\n" + texto;
    const nLinhas = texto.split(/\r?\n/).filter((l) => l.trim()).length - 1;
    const usage = response.usage || {};
    return json({ texto, linhas: nLinhas, cortado: response.stop_reason === "max_tokens", tokens: { entrada: usage.input_tokens || 0, saida: usage.output_tokens || 0 } });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "Chave da API da Anthropic inválida." }, 502);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "Limite da API atingido. Tente de novo em instantes." }, 503);
    if (e instanceof Anthropic.APIError) return json({ error: "Erro na API da Anthropic (" + e.status + "): " + e.message }, 502);
    return json({ error: "Falha ao ler a imagem: " + (e && e.message ? e.message : e) }, 500);
  }
};
