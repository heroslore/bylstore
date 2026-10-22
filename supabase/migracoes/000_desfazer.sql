-- 000_desfazer.sql — volta ao acesso aberto de antes (use só em emergência, se o programa parar).
begin;
do $$
declare t text;
begin
  foreach t in array array['estoque', 'orcamentos', 'produtos_custom'] loop
    execute format('drop policy if exists leitura_logado on public.%I', t);
    execute format('drop policy if exists grava_admin_insert on public.%I', t);
    execute format('drop policy if exists grava_admin_update on public.%I', t);
    execute format('drop policy if exists grava_admin_delete on public.%I', t);
    execute format('grant select, insert, update, delete on public.%I to anon, authenticated', t);
    execute format('create policy acesso_aberto on public.%I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;
commit;
