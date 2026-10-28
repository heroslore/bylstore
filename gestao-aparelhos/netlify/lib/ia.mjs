// Cliente da Anthropic usado por todas as funções.
// Regra: só usa uma chave que VOCÊ cadastrou na Netlify (ANTHROPIC_API_KEY) e fala direto com api.anthropic.com.
// A Netlify injeta uma ANTHROPIC_API_KEY própria (AI Gateway) quando você não cadastra a sua, e cobra os tokens em
// créditos da conta. Isso pausou o site em out/2026. Aqui essa chave injetada é ignorada.
import Anthropic from "@anthropic-ai/sdk";

const env = (k) => (typeof Netlify !== "undefined" && Netlify.env ? Netlify.env.get(k) : process.env[k]) || "";

export function chaveIA() {
  const key = env("ANTHROPIC_API_KEY");
  if (!key) return null;
  // Chave injetada pelo AI Gateway: vem junto com ANTHROPIC_BASE_URL apontando para a Netlify, ou é igual à chave do gateway.
  const base = env("ANTHROPIC_BASE_URL");
  if (base && /netlify/i.test(base)) return null;
  if (env("NETLIFY_AI_GATEWAY_KEY") && key === env("NETLIFY_AI_GATEWAY_KEY")) return null;
  return key;
}
export const temIA = () => !!chaveIA();
export const ERRO_SEM_CHAVE = "IA não configurada: cadastre a sua chave da Anthropic na Netlify como ANTHROPIC_API_KEY (Configuração do projeto → Variáveis de ambiente). O portal de IA da Netlify não é usado para não consumir os créditos do site.";
export function clienteIA() {
  const apiKey = chaveIA();
  if (!apiKey) throw new Error(ERRO_SEM_CHAVE);
  return new Anthropic({ apiKey, baseURL: "https://api.anthropic.com" });
}
