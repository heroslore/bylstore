import test from "node:test"; import assert from "node:assert/strict";
import { chaveIA } from "../netlify/lib/ia.mjs";
test("ignora a chave injetada pelo AI Gateway da Netlify", () => {
  const env = globalThis.__env;
  env.ANTHROPIC_API_KEY = "nf-abc"; env.ANTHROPIC_BASE_URL = "https://ai-gateway.netlify.app/v1";
  assert.equal(chaveIA(), null);
  env.ANTHROPIC_BASE_URL = ""; env.NETLIFY_AI_GATEWAY_KEY = "nf-abc";
  assert.equal(chaveIA(), null);
  env.NETLIFY_AI_GATEWAY_KEY = "outra"; env.ANTHROPIC_API_KEY = "sk-ant-minha";
  assert.equal(chaveIA(), "sk-ant-minha");
  delete env.ANTHROPIC_API_KEY; assert.equal(chaveIA(), null);
});
