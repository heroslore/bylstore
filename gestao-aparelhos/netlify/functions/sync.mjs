// Sincronização dos dados do app entre aparelhos + senha de acesso.
// GET  /api/sync            -> { updatedAt, dados } ou null
// PUT  /api/sync            -> body { baseUpdatedAt, updatedAt, dados }; 409 se a nuvem estiver mais nova que baseUpdatedAt
// POST /api/sync/senha      -> body { atual, nova }; troca a senha de acesso
// A senha vem do blob "auth" (hash PBKDF2). Sem blob, vale a variável SYNC_KEY (senha inicial).
import { getStore } from "@netlify/blobs";

export const config = { path: ["/api/sync", "/api/sync/senha"] };

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

const enc = new TextEncoder();
const toHex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
const ITER = 120000;

async function derive(senha, saltHex) {
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey("raw", enc.encode(senha), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITER }, key, 256);
  return toHex(bits);
}
async function hashSenha(senha) {
  const saltHex = toHex(crypto.getRandomValues(new Uint8Array(16)));
  return { salt: saltHex, hash: await derive(senha, saltHex), iter: ITER, alteradaEm: new Date().toISOString() };
}
function sameStr(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function senhaConfere(store, provided) {
  if (typeof provided !== "string" || !provided) return false;
  const auth = await store.get("auth", { type: "json" });
  if (auth && auth.salt && auth.hash) return sameStr(await derive(provided, auth.salt), auth.hash);
  const inicial = Netlify.env.get("SYNC_KEY");
  return !!inicial && sameStr(provided, inicial);
}

export default async (req) => {
  const url = new URL(req.url);
  const store = getStore({ name: "gestao-aparelhos", consistency: "strong" });
  const hasInitial = !!Netlify.env.get("SYNC_KEY");
  const auth = await store.get("auth", { type: "json" });
  if (!hasInitial && !(auth && auth.hash)) return json({ error: "Sincronização não configurada no servidor." }, 503);

  if (url.pathname.endsWith("/senha")) {
    if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
    let body;
    try { body = await req.json(); } catch (e) { return json({ error: "JSON inválido." }, 400); }
    if (!(await senhaConfere(store, body && body.atual))) return json({ error: "Senha atual incorreta." }, 401);
    const nova = typeof body.nova === "string" ? body.nova.trim() : "";
    if (nova.length < 6) return json({ error: "A nova senha precisa ter pelo menos 6 caracteres." }, 400);
    await store.setJSON("auth", await hashSenha(nova));
    return json({ ok: true });
  }

  if (!(await senhaConfere(store, req.headers.get("x-sync-key") || ""))) return json({ error: "Senha de sincronização inválida." }, 401);

  if (req.method === "GET") {
    const cur = await store.get("state", { type: "json" });
    return json(cur || null);
  }

  if (req.method === "PUT") {
    let body;
    try { body = await req.json(); } catch (e) { return json({ error: "JSON inválido." }, 400); }
    if (!body || typeof body.updatedAt !== "number" || !body.dados || typeof body.dados !== "object") return json({ error: "Corpo inválido." }, 400);
    const cur = await store.get("state", { type: "json" });
    const base = typeof body.baseUpdatedAt === "number" ? body.baseUpdatedAt : 0;
    if (cur && cur.updatedAt !== base && !body.force) return json({ conflict: true, updatedAt: cur.updatedAt, dados: cur.dados }, 409);
    const rec = { updatedAt: body.updatedAt, dados: body.dados, salvoEm: new Date().toISOString() };
    await store.setJSON("state", rec);
    return json({ ok: true, updatedAt: rec.updatedAt });
  }

  return json({ error: "Método não permitido." }, 405);
};
