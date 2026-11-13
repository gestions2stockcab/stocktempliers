-- SimSimStock · les conversations internes s'effacent après 24 heures
-- Les tâches (kind = 'tache') ne sont PAS effacées. Les réactions des messages effacés partent avec eux (on delete cascade).
-- À lancer une fois dans Supabase > SQL Editor. Nécessite pg_cron (déjà utilisé pour le bilan du lundi).
create extension if not exists pg_cron;

create or replace function public.purger_messages_24h() returns integer
language sql security definer set search_path = public as $$
  with d as (
    delete from public.messages
    where coalesce(kind, 'message') <> 'tache'
      and created_at < now() - interval '24 hours'
    returning 1
  ) select count(*)::int from d;
$$;
revoke all on function public.purger_messages_24h() from public, anon, authenticated;

-- toutes les heures, à la 7e minute
select cron.unschedule('purger_messages_24h') where exists (select 1 from cron.job where jobname = 'purger_messages_24h');
select cron.schedule('purger_messages_24h', '7 * * * *', $$ select public.purger_messages_24h(); $$);

-- premier nettoyage tout de suite
select public.purger_messages_24h() as messages_effaces;
