// Sincronização dos dados do app entre aparelhos.
// GET  /api/sync  -> { updatedAt, dados } ou null
// PUT  /api/sync  -> body { baseUpdatedAt, updatedAt, dados }; 409 se a nuvem estiver mais nova que baseUpdatedAt
import { getStore } from "@netlify/blobs";

export const config = { path: "/api/sync" };

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

function sameKey(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default async (req) => {
  const expected = Netlify.env.get("SYNC_KEY");
  if (!expected) return json({ error: "Sincronização não configurada no servidor." }, 503);
  if (!sameKey(req.headers.get("x-sync-key") || "", expected)) return json({ error: "Senha de sincronização inválida." }, 401);

  const store = getStore({ name: "gestao-aparelhos", consistency: "strong" });

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
