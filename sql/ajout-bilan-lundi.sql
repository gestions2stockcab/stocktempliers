-- SimSimStock · bilan du lundi par e-mail pour le propriétaire
-- Prérequis : la fonction Supabase « bilan-proprietaire » (fichier bilan-proprietaire.ts) est déployée,
-- et le récap du lundi est déjà configuré (même clé x-cron-secret dans le coffre-fort, même clé publique).
-- À lancer une fois dans Supabase : SQL Editor → New query → coller → Run. Peut être relancé sans risque.

create or replace function public.bilan_proprietaire(p_test text default null)
 returns bigint language plpgsql security definer set search_path to 'public'
as $function$
declare k text; a text;
begin
  -- appelé par pg_cron (pas de session) ou par le propriétaire depuis l'appli (envoi d'essai)
  if auth.uid() is not null and not public.est_proprietaire() then raise exception 'forbidden'; end if;
  select decrypted_secret into k from vault.decrypted_secrets where name = 'recap_secret';
  select anon into a from public.reglages_recap where id = 1;
  if coalesce(k, '') = '' or coalesce(a, '') = '' then raise exception 'non_configure'; end if;
  return net.http_post(
    url := 'https://wcalquzjehvhcjevjwxe.supabase.co/functions/v1/bilan-proprietaire',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || a, 'x-cron-secret', k),
    body := case when p_test is null then '{}'::jsonb else jsonb_build_object('test', p_test) end,
    timeout_milliseconds := 55000);
end $function$;
revoke all on function public.bilan_proprietaire(text) from public, anon;
grant execute on function public.bilan_proprietaire(text) to authenticated;

-- chaque lundi à 6 h 35 UTC : 7 h 35 à Paris en hiver, 8 h 35 en été
select cron.unschedule('bilan_proprietaire') where exists (select 1 from cron.job where jobname = 'bilan_proprietaire');
select cron.schedule('bilan_proprietaire', '35 6 * * 1', $$ select public.bilan_proprietaire(); $$);
