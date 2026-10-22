// Rotina agendada: Relatório diário às 08:00 (horário de Brasília). Nível 1 apenas (análises, alertas, relatório em memória). Pode ser desativada em /api/agentes/rotinas.
import Anthropic from "@anthropic-ai/sdk";
import { executarRotina } from "../lib/agentes.mjs";

export const config = { schedule: "0 11 * * *" };

export default async () => {
  const apiKey = Netlify.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) { console.log("rotina diaria: ANTHROPIC_API_KEY ausente"); return new Response("sem chave", { status: 503 }); }
  const r = await executarRotina("diaria", { cliente: new Anthropic({ apiKey }) });
  console.log("rotina diaria:", r.pulada ? "pulada" : r.task_id + " " + r.status);
  return new Response(JSON.stringify(r.pulada ? r : { task_id: r.task_id, status: r.status }), { headers: { "content-type": "application/json" } });
};
