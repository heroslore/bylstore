// core/calculos.js — cálculos financeiros da BYL STORE / Heros Cell.
// Funções puras e determinísticas: a página e os agentes usam as mesmas contas.
// Valores em reais; percentuais como fração (0,25 = 25%).

export function centavos(v) {
  return Math.round((Number(v) + Number.EPSILON) * 100) / 100;
}

function exigirNumero(nome, v, { min = -Infinity } = {}) {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new TypeError(`${nome} precisa ser número`);
  if (v < min) throw new RangeError(`${nome} não pode ser menor que ${min}`);
  return v;
}

// Custo de aquisição de uma unidade: preço em dólar × cotação + despesas por unidade (frete, taxas).
export function custoAquisicao({ usd, cotacao, frete = 0, outras = 0 }) {
  exigirNumero("usd", usd, { min: 0 });
  exigirNumero("cotacao", cotacao, { min: 0 });
  return centavos(usd * cotacao + frete + outras);
}

export function custoMedio({ qtd, custoTotal }) {
  return qtd > 0 ? custoTotal / qtd : 0;
}

// Markup: quanto o preço está acima do custo, sobre o CUSTO. 2,5× => 1,5 (150%).
export function markup(preco, custo) {
  exigirNumero("preco", preco);
  exigirNumero("custo", custo);
  return custo > 0 ? (preco - custo) / custo : null;
}

// Margem bruta: quanto do PREÇO sobra depois do custo. 2,5× => 0,6 (60%).
export function margemBruta(preco, custo) {
  exigirNumero("preco", preco);
  exigirNumero("custo", custo);
  return preco > 0 ? (preco - custo) / preco : null;
}

// Margem de contribuição: preço − custo − custos variáveis da venda (taxas, comissão, garantia estimada).
export function margemContribuicao({ preco, custo, taxaPct = 0, comissaoPct = 0, garantiaEstimada = 0, outros = 0 }) {
  const variaveis = preco * (taxaPct + comissaoPct) + garantiaEstimada + outros;
  const valor = centavos(preco - custo - variaveis);
  return { valor, percentual: preco > 0 ? valor / preco : null, custosVariaveis: centavos(variaveis) };
}

// Menor preço que ainda entrega a margem mínima depois das taxas percentuais.
export function precoMinimo({ custo, margemMinima = 0, taxaPct = 0, comissaoPct = 0, fixosPorUnidade = 0 }) {
  const divisor = 1 - margemMinima - taxaPct - comissaoPct;
  if (divisor <= 0) throw new RangeError("margem + taxas chegam a 100% ou mais");
  return centavos((custo + fixosPorUnidade) / divisor);
}

export function descontoMaximo(precoAtual, minimo) {
  const valor = centavos(Math.max(0, precoAtual - minimo));
  return { valor, percentual: precoAtual > 0 ? valor / precoAtual : 0 };
}

// Planos do programa atual (index.html: PS). acrescimo 1,10 = +10% no prazo.
export const PLANOS_PADRAO = {
  p6: { n: 6, acrescimo: 1.0, entradaPct: 0.2 },
  p8: { n: 8, acrescimo: 1.1, entradaPct: 0.25 },
  p12: { n: 12, acrescimo: 1.2, entradaPct: 0.3 },
};

export function planoParcelado(base, { n, acrescimo, entradaPct }, entrada = null) {
  const total = base * acrescimo;
  const ent = entrada == null ? total * entradaPct : Math.max(0, Math.min(entrada, total));
  return { n, total: centavos(total), entrada: centavos(ent), parcela: centavos((total - ent) / n) };
}

function dataLocal(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}
function isoLocal(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
export function hojeLocal(agora = new Date()) {
  return isoLocal(agora);
}

// Mesma regra do programa (genParcs): 1ª parcela no próximo dia de vencimento, proporcional aos dias / 30.
export function gerarParcelas(dataVenda, dia, n, valor) {
  const d = dataLocal(dataVenda);
  const primeira = new Date(d.getFullYear(), d.getMonth(), dia, 12);
  if (primeira <= d) primeira.setMonth(primeira.getMonth() + 1);
  const dias = Math.round((primeira - d) / 864e5);
  const parcelas = [{ num: 1, venc: isoLocal(primeira), valor: centavos((valor * dias) / 30), prop: dias !== 30, pago: false }];
  for (let i = 1; i < n; i++) {
    const v = new Date(primeira);
    v.setMonth(v.getMonth() + i);
    parcelas.push({ num: i + 1, venc: isoLocal(v), valor, prop: false, pago: false });
  }
  return parcelas;
}

// Situação de uma venda parcelada: contratado, recebido, pendente, atrasado, lucro esperado e realizado.
export function situacaoVenda(venda, hoje) {
  const parcelas = venda.parcelas || [];
  const entrada = venda.entrada || 0;
  const contratado = entrada + parcelas.reduce((s, p) => s + p.valor, 0);
  const recebido = entrada + parcelas.filter((p) => p.pago).reduce((s, p) => s + p.valor, 0);
  const atrasadas = parcelas.filter((p) => !p.pago && p.venc < hoje);
  return {
    contratado: centavos(contratado),
    recebido: centavos(recebido),
    pendente: centavos(contratado - recebido),
    atrasado: centavos(atrasadas.reduce((s, p) => s + p.valor, 0)),
    parcelasAtrasadas: atrasadas.length,
    lucroEsperado: centavos(contratado - venda.custo),
    // Caixa: só é lucro o que entrou acima do custo do aparelho.
    lucroRealizado: centavos(recebido - venda.custo),
    diferencaDoPlano: venda.venda != null ? centavos(contratado - venda.venda) : null,
  };
}

export function diasEntre(deIso, ateIso) {
  return Math.round((dataLocal(ateIso) - dataLocal(deIso)) / 864e5);
}
