// Sincronização dos dados do app entre aparelhos + senha de acesso.
// GET  /api/sync            -> { updatedAt, dados } ou null
// PUT  /api/sync            -> body { baseUpdatedAt, updatedAt, dados }; 409 se a nuvem estiver mais nova que baseUpdatedAt
// POST /api/sync/senha      -> body { atual, nova }; troca a senha de acesso
import { json, store, senhaConfere, configurada, hashSenha } from "../lib/auth.mjs";

export const config = { path: ["/api/sync", "/api/sync/senha"] };

export default async (req) => {
  const url = new URL(req.url);
  const st = store();
  if (!(await configurada(st))) return json({ error: "Sincronização não configurada no servidor." }, 503);

  if (url.pathname.endsWith("/senha")) {
    if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
    let body;
    try { body = await req.json(); } catch (e) { return json({ error: "JSON inválido." }, 400); }
    if (!(await senhaConfere(st, body && body.atual))) return json({ error: "Senha atual incorreta." }, 401);
    const nova = typeof body.nova === "string" ? body.nova.trim() : "";
    if (nova.length < 6) return json({ error: "A nova senha precisa ter pelo menos 6 caracteres." }, 400);
    await st.setJSON("auth", await hashSenha(nova));
    return json({ ok: true });
  }

  if (!(await senhaConfere(st, req.headers.get("x-sync-key") || ""))) return json({ error: "Senha de sincronização inválida." }, 401);

  if (req.method === "GET") {
    const cur = await st.get("state", { type: "json" });
    return json(cur || null);
  }

  if (req.method === "PUT") {
    let body;
    try { body = await req.json(); } catch (e) { return json({ error: "JSON inválido." }, 400); }
    if (!body || typeof body.updatedAt !== "number" || !body.dados || typeof body.dados !== "object") return json({ error: "Corpo inválido." }, 400);
    const cur = await st.get("state", { type: "json" });
    const base = typeof body.baseUpdatedAt === "number" ? body.baseUpdatedAt : 0;
    if (cur && cur.updatedAt !== base && !body.force) return json({ conflict: true, updatedAt: cur.updatedAt, dados: cur.dados }, 409);
    const rec = { updatedAt: body.updatedAt, dados: body.dados, salvoEm: new Date().toISOString() };
    await st.setJSON("state", rec);
    return json({ ok: true, updatedAt: rec.updatedAt });
  }

  return json({ error: "Método não permitido." }, 405);
};
