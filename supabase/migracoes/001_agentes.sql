-- 001_agentes.sql — tabelas da camada de agentes (para quando a memória/fila sair do PC e for para o banco).
-- No modelo atual (agentes no PC) estas tabelas NÃO são necessárias: a fila e a memória ficam em
-- dados-agentes/agentes.json no PC. Só cria tabelas novas; não toca nas tabelas do programa.
create table if not exists public.agente_tarefas (
  task_id text primary key, agent text not null, action text not null, status text not null,
  input jsonb not null default '{}', result jsonb, evidence jsonb not null default '[]', error text,
  requires_approval boolean not null default false, depends_on text[] not null default '{}', parent_id text,
  idempotency_key text not null, tentativas int not null default 0, max_tentativas int not null default 3,
  rodada_correcao int not null default 0, revisao jsonb, prazo_execucao timestamptz, log jsonb not null default '[]',
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now()
);
create index if not exists agente_tarefas_status on public.agente_tarefas (status);
create unique index if not exists agente_tarefas_idem on public.agente_tarefas (idempotency_key)
  where status not in ('FALHOU', 'CANCELADA');

create table if not exists public.agente_memoria (
  id text primary key, tipo text not null, assunto text not null, texto text not null, agente text, task_id text,
  aparelho_id text, operacao text, palavras text[] not null default '{}', refs jsonb not null default '[]',
  valido_ate timestamptz, criado_em timestamptz not null default now(),
  busca tsvector generated always as (to_tsvector('portuguese', assunto || ' ' || texto)) stored
);
create index if not exists agente_memoria_busca on public.agente_memoria using gin (busca);

create table if not exists public.agente_auditoria (
  seq bigint primary key, em timestamptz not null, ator text not null, acao text not null, task_id text,
  detalhes jsonb not null default '{}', hash_anterior text, hash text not null
);
create table if not exists public.agente_aprovacoes (
  id text primary key, task_id text not null, ferramenta text not null, nivel int not null, operacao text not null,
  input jsonb not null, resumo text, solicitado_por text, status text not null, codigo_confirmacao text,
  criado_em timestamptz not null, expira_em timestamptz not null, decidido_por text, decidido_em timestamptz,
  motivo text, usada boolean not null default false
);
create table if not exists public.agente_rotinas (
  nome text primary key, config jsonb not null, ultimo_periodo text, ultima_execucao jsonb
);
do $$
declare t text;
begin
  foreach t in array array['agente_tarefas','agente_memoria','agente_auditoria','agente_aprovacoes','agente_rotinas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);  -- só o servidor dos agentes (service role)
  end loop;
end $$;
