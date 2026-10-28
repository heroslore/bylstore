// Rotina agendada: Análise semanal, segunda-feira 08:00. Nível 1 apenas (análises, alertas, relatório em memória). Pode ser desativada em /api/agentes/rotinas.
import { clienteIA, temIA } from "../lib/ia.mjs";
import { executarRotina } from "../lib/agentes.mjs";

export const config = { schedule: "0 11 * * 1" };

export default async () => {
  if (!temIA()) { console.log("rotina semanal: chave da Anthropic ausente"); return new Response("sem chave", { status: 503 }); }
  const r = await executarRotina("semanal", { cliente: clienteIA() });
  console.log("rotina semanal:", r.pulada ? "pulada" : r.task_id + " " + r.status);
  return new Response(JSON.stringify(r.pulada ? r : { task_id: r.task_id, status: r.status }), { headers: { "content-type": "application/json" } });
};
