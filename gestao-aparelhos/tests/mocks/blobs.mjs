// Store em memória com a mesma interface usada pelo código (get/setJSON/delete). Persistência simulada por nome.
const REG = globalThis.__blobs || (globalThis.__blobs = new Map());
export function getStore(opts) {
  const name = typeof opts === "string" ? opts : opts.name;
  if (!REG.has(name)) REG.set(name, new Map());
  const m = REG.get(name);
  return {
    name,
    get: async (k, o) => { if (!m.has(k)) return null; const v = m.get(k); return o && o.type === "json" ? JSON.parse(v) : v; },
    setJSON: async (k, v) => { m.set(k, JSON.stringify(v)); },
    set: async (k, v) => { m.set(k, String(v)); },
    delete: async (k) => { m.delete(k); },
    _map: m,
  };
}
export function resetStores() { REG.clear(); }
