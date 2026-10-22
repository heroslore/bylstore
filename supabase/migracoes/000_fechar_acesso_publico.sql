-- 000_fechar_acesso_publico.sql — fecha o acesso anônimo às tabelas do programa.
--
-- ANTES de rodar (senão o programa para de sincronizar):
--   1. Supabase → Authentication → Users → "Add user": crie o seu usuário (e-mail + senha).
--      Marque "Auto Confirm User". Crie também o usuário dos agentes (agentes@byl.local), que só vai LER.
--      Em Authentication → Sign In / Providers, desligue "Allow new users to sign up".
--   2. Publique o index.html novo (com a tela de login).
--   3. Troque o e-mail abaixo pelo seu e rode este arquivo no SQL Editor.
-- Para voltar atrás: 000_desfazer.sql.
--
-- Não apaga nem altera nenhum dado. Só muda quem pode ler e gravar.

begin;

-- Quem pode entrar. Estar logado não basta: o e-mail precisa estar nesta lista.
--   papel 'admin'   = lê e grava (proprietário e equipe)
--   papel 'leitura' = só lê (usuário dos agentes)
create table if not exists public.app_usuarios (
  email text primary key,
  papel text not null check (papel in ('admin', 'leitura')),
  criado_em timestamptz not null default now()
);
alter table public.app_usuarios enable row level security;   -- sem políticas: só o SQL Editor mexe nela
revoke all on public.app_usuarios from anon, authenticated;

insert into public.app_usuarios (email, papel) values
  ('TROQUE-PELO-SEU-EMAIL@exemplo.com', 'admin'),
  ('agentes@byl.local', 'leitura')
on conflict (email) do update set papel = excluded.papel;

create or replace function public.papel_app() returns text
language sql stable security definer set search_path = public as $$
  select u.papel from public.app_usuarios u where lower(u.email) = lower(auth.jwt() ->> 'email');
$$;
revoke all on function public.papel_app() from public, anon;
grant execute on function public.papel_app() to authenticated;

-- Remove as políticas atuais das 3 tabelas (as que liberam acesso anônimo) e cria as novas.
do $$
declare p record;
begin
  for p in select policyname, tablename from pg_policies
           where schemaname = 'public' and tablename in ('estoque', 'orcamentos', 'produtos_custom')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['estoque', 'orcamentos', 'produtos_custom'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy leitura_logado on public.%I for select to authenticated using (public.papel_app() is not null)', t);
    execute format('create policy grava_admin_insert on public.%I for insert to authenticated with check (public.papel_app() = ''admin'')', t);
    execute format('create policy grava_admin_update on public.%I for update to authenticated using (public.papel_app() = ''admin'') with check (public.papel_app() = ''admin'')', t);
    execute format('create policy grava_admin_delete on public.%I for delete to authenticated using (public.papel_app() = ''admin'')', t);
  end loop;
end $$;

commit;

-- Conferência (deve listar 4 políticas por tabela):
-- select tablename, policyname, cmd, roles from pg_policies where tablename in ('estoque','orcamentos','produtos_custom') order by 1, 2;
