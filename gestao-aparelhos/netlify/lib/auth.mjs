// Senha de acesso: hash PBKDF2 no blob "auth"; sem blob vale SYNC_KEY (senha inicial).
import { getStore } from "@netlify/blobs";

const enc = new TextEncoder();
const toHex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
export const ITER = 120000;

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export const store = () => getStore({ name: "gestao-aparelhos", consistency: "strong" });

export async function derive(senha, saltHex) {
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey("raw", enc.encode(senha), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITER }, key, 256);
  return toHex(bits);
}
export async function hashSenha(senha) {
  const saltHex = toHex(crypto.getRandomValues(new Uint8Array(16)));
  return { salt: saltHex, hash: await derive(senha, saltHex), iter: ITER, alteradaEm: new Date().toISOString() };
}
export function sameStr(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export async function senhaConfere(st, provided) {
  if (typeof provided !== "string" || !provided) return false;
  const auth = await st.get("auth", { type: "json" });
  if (auth && auth.salt && auth.hash) return sameStr(await derive(provided, auth.salt), auth.hash);
  const inicial = Netlify.env.get("SYNC_KEY");
  return !!inicial && sameStr(provided, inicial);
}
export async function configurada(st) {
  if (Netlify.env.get("SYNC_KEY")) return true;
  const auth = await st.get("auth", { type: "json" });
  return !!(auth && auth.hash);
}
