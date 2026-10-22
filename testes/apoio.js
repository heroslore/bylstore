// testes/apoio.js — dados de teste (cópia do estoque inicial do index.html) e relógio controlado.
// Nenhum teste acessa o Supabase real nem executa operação financeira real.

import { Coordenador } from "../agentes/coordenador.js";
import { FonteFixture } from "../agentes/ferramentas/dados.js";
import { ArmazemMemoria } from "../agentes/nucleo/armazem.js";

export const ESTOQUE = [
  { cod: "116860-0", nome: "XIAOMI POCO M7 PRO 5G DS/6RAM/128GB LUNAR DUST INDIA", short: "POCO M7 PRO 5G · 128GB", usd: 154, qtd: 1, custo_total: 826.98 },
  { cod: "119811-9", nome: "SAMSUNG A26 5G SM-A266M DS/8RAM/256GB BLACK CX SLIM", short: "Galaxy A26 5G · 256GB", usd: 220, qtd: 1, custo_total: 1181.4 },
  { cod: "126141-7", nome: "XIAOMI POCO M7 4G DS/6RAM/128GB BLUE GLOBAL BR", short: "POCO M7 4G · 128GB", usd: 118, qtd: 4, custo_total: 2534.64 },
  { cod: "127597-1", nome: "SAMSUNG A17 SM-A175F DS/7RAM/128GB BLACK CX/SLIM GLOBAL", short: "Galaxy A17 · 128GB Black", usd: 165, qtd: 0, custo_total: 0 },
];

export const VENDA = {
  id: "o1", criado: "2026-09-01", status: "vendido", venda_data: "2026-09-01", plano_esc: "p8",
  produto: { cod: "119811-9", short: "Galaxy A26 5G · 256GB" }, custo: 1181.4, venda: 2953.5, entrada: 812.21,
  parcelas: [
    { num: 1, venc: "2026-09-05", valor: 46.81, pago: true },
    { num: 2, venc: "2026-10-05", valor: 351.08, pago: false },
    { num: 3, venc: "2026-11-05", valor: 351.08, pago: false },
  ],
};

export function relogio(iso = "2026-10-22T11:00:00") {
  const r = { agora: new Date(iso) };
  r.fn = () => new Date(r.agora);
  r.avancar = (ms) => { r.agora = new Date(r.agora.getTime() + ms); };
  return r;
}

export function montar({ estoque = ESTOQUE, orcamentos = [VENDA], armazem = new ArmazemMemoria(), rel = relogio(), ...extra } = {}) {
  const fonte = new FonteFixture({ estoque, orcamentos });
  const c = new Coordenador({ armazem, fonte, relogio: rel.fn, ...extra });
  return { c, fonte, rel, armazem };
}

export const DONO = { tipo: "humano", usuario: "ygor", papel: "proprietario", autenticado: true };
