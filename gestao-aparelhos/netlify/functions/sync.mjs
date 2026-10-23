// Sincronização dos dados do app entre aparelhos + senha de acesso.
// GET  /api/sync            -> { updatedAt, dados } ou null
// PUT  /api/sync            -> body { baseUpdatedAt, updatedAt, dados }; 409 se a nuvem estiver mais nova que baseUpdatedAt
// POST /api/sync/senha      -> body { atual, nova }; troca a senha de acesso
import { json, store, senhaConfere, configurada, hashSenha } from "../lib/auth.mjs";

export const config = { path: ["/api/sync", "/api/sync/senha", "/api/sync/precos"] };

// Manutenção da lista de preços pela chave de administração (ADMIN_KEY), para atualizar a nuvem sem a senha do app.
// GET  /api/sync/precos            -> lista atual
// POST /api/sync/precos { precos: [{modelo, preco}], modo: "merge"|"replace" }
async function rotaPrecos(req, st) {
  const admin = Netlify.env.get("ADMIN_KEY");
  const chave = req.headers.get("x-admin-key") || "";
  const porSenha = await senhaConfere(st, req.headers.get("x-sync-key") || "");
  if (!porSenha && !(admin && chave && chave === admin)) return json({ error: "Não autorizado." }, 401);
  const rec = await st.get("state", { type: "json" });
  const dados = (rec && rec.dados) || { settings: {}, precos: [], compras: [], vendas: [], clientes: [] };
  if (req.method === "GET") return json({ updatedAt: rec ? rec.updatedAt : 0, precos: (dados.precos || []).map((p) => ({ modelo: p.modelo, preco: p.preco })) });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  let body; try { body = await req.json(); } catch (e) { return json({ error: "JSON inválido." }, 400); }
  const lista = Array.isArray(body && body.precos) ? body.precos : null;
  if (!lista) return json({ error: "Envie precos: [{modelo, preco}]." }, 400);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  let precos = Array.isArray(dados.precos) ? dados.precos : [];
  if (body.modo === "replace") precos = [];
  let n = 0, upd = 0;
  for (const item of lista) {
    const modelo = String(item.modelo || "").trim(); const preco = Number(item.preco);
    if (!modelo || !Number.isFinite(preco) || preco < 0) continue;
    const ex = precos.find((p) => String(p.modelo).trim().toLowerCase() === modelo.toLowerCase());
    if (ex) { if (ex.preco !== preco) { ex.preco = preco; upd++; } } else { precos.push({ id: uid(), modelo, preco }); n++; }
  }
  const updatedAt = Date.now();
  await st.setJSON("state", { updatedAt, dados: { ...dados, precos, updatedAt }, salvoEm: new Date().toISOString(), origem: "admin-precos" });
  return json({ ok: true, adicionados: n, atualizados: upd, total: precos.length, updatedAt });
}

export default async (req) => {
  const url = new URL(req.url);
  const st = store();
  if (!(await configurada(st))) return json({ error: "Sincronização não configurada no servidor." }, 503);
  if (url.pathname.endsWith("/precos")) return rotaPrecos(req, st);

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
