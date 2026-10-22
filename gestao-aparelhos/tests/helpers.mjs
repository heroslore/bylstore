import { getStore, resetStores } from "./mocks/blobs.mjs";
export { resetStores };
export function estadoExemplo() {
  const s = { taxaFixa: 17, notaPct: 70, frete1: 7.5, frete2: 8, cotacao: 5.4 };
  return {
    settings: { ...s, empresa: "Heros Cell", contato: "" },
    precos: [{ id: "p1", modelo: "iPhone 13 128GB", preco: 1700 }, { id: "p2", modelo: "iPhone 14 Pro 128GB", preco: 2600 }, { id: "p3", modelo: "iPhone 15 128GB", preco: 2500 }, { id: "p4", modelo: "iPhone 13 Pro Max 128GB", preco: 2500 }],
    compras: [
      { id: "c1", nome: "Leilão 01/09", data: "2026-09-01", settings: s, rows: [{ id: "r1", modelo: "iPhone 13 128GB", preco: 233, notaPct: null, qty: 5 }, { id: "r2", modelo: "iPhone 14 Pro 128GB", preco: 359, notaPct: null, qty: 2 }] },
      { id: "c2", nome: "Leilão 10/10", data: "2026-10-10", settings: { ...s, cotacao: 5.2 }, rows: [{ id: "r3", modelo: "iPhone 13 128GB", preco: 232, notaPct: 90, qty: 4 }] },
    ],
    vendas: [
      { id: "v1", data: "2026-09-15", clienteId: "k1", clienteNome: "Loja do Zé", itens: [{ compraId: "c1", rowId: "r1", modelo: "iPhone 13 128GB", qty: 2, preco: 1700 }] },
      { id: "v2", data: "2026-10-12", clienteId: "k2", clienteNome: "Maria", itens: [{ compraId: "c1", rowId: "r2", modelo: "iPhone 14 Pro 128GB", qty: 1, preco: 2600 }] },
    ],
    clientes: [{ id: "k1", nome: "Loja do Zé" }, { id: "k2", nome: "Maria" }],
    updatedAt: 1000,
  };
}
export async function semearEstado(dados = estadoExemplo()) {
  const st = getStore({ name: "gestao-aparelhos" });
  await st.setJSON("state", { updatedAt: dados.updatedAt || 1000, dados });
  return st;
}
