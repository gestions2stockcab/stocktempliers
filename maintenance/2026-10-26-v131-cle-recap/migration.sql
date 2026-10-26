-- v131 : la clé x-cron-secret passe de reglages_recap.secret au coffre-fort (Supabase Vault).
-- Déjà appliqué le 26/10/2026. À rejouer seulement sur une base qui a encore la colonne « secret ».
begin;
select vault.create_secret((select secret from public.reglages_recap where id = 1), 'recap_secret', 'Clé x-cron-secret des fonctions planifiées SimSimStock (v131)');

create or replace function public.recap_lundi(p_test text default null)
 returns bigint language plpgsql security definer set search_path to 'public'
as $function$
declare r public.reglages_recap; k text;
begin
  select * into r from public.reglages_recap where id = 1;
  select decrypted_secret into k from vault.decrypted_secrets where name = 'recap_secret';
  if r.id is null or r.url = '' or coalesce(k, '') = '' then raise exception 'non_configure'; end if;
  return net.http_post(
    url := r.url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || r.anon, 'x-cron-secret', k),
    body := case when p_test is null then '{}'::jsonb else jsonb_build_object('test', p_test) end,
    timeout_milliseconds := 55000);
end $function$;

create or replace function public.configurer_recap(p_url text, p_secret text, p_anon text)
 returns text language plpgsql security definer set search_path to 'public'
as $function$
declare sid uuid;
begin
  if coalesce(p_url, '') !~ '^https://' then raise exception 'adresse_invalide'; end if;
  if length(coalesce(p_secret, '')) < 12 then raise exception 'secret_trop_court'; end if;
  insert into public.reglages_recap (id, url, anon) values (1, p_url, coalesce(p_anon, ''))
  on conflict (id) do update set url = excluded.url, anon = excluded.anon;
  select id into sid from vault.secrets where name = 'recap_secret';
  if sid is null then perform vault.create_secret(p_secret, 'recap_secret');
  else perform vault.update_secret(sid, p_secret); end if;
  return 'Récap du lundi configuré.';
end $function$;
revoke execute on function public.configurer_recap(text, text, text) from public, anon, authenticated;

create or replace function public.notifier_push_envoyer()
 returns trigger language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare k text;
begin
  begin
    select decrypted_secret into k from vault.decrypted_secrets where name = 'recap_secret';
    perform net.http_post(
      url := 'https://wcalquzjehvhcjevjwxe.supabase.co/functions/v1/notifier-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', coalesce(k, ''),
        'Authorization', 'Bearer ' || (select anon from public.reglages_recap where id = 1)),
      body := jsonb_build_object('type', TG_OP, 'table', TG_TABLE_NAME, 'schema', TG_TABLE_SCHEMA, 'record', to_jsonb(new),
        'old_record', case when TG_OP = 'UPDATE' then to_jsonb(old) else null end)
    );
  exception when others then null;   -- une panne de notification ne doit jamais bloquer un message
  end;
  return new;
end $function$;

alter table public.reglages_recap drop column secret;
revoke all on public.reglages_recap from anon, authenticated;
commit;
