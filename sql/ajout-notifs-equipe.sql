-- SimSimStock · « Qui reçoit les notifications ? » : pour chaque personne du cabinet, ses appareils inscrits aux notifications
-- (jamais les adresses techniques des appareils : seulement le nombre, le type d'appareil, la date d'inscription et si les messages sont coupés).
-- À lancer une fois dans Supabase : SQL Editor → New query → coller → Run. Peut être relancé sans risque.

create or replace function public.push_etat_equipe(p_cabinet uuid)
returns table (user_id uuid, appareils integer, inscrit_le timestamptz, messages_coupes integer, types text[])
language sql security definer stable set search_path = public as $$
  select m.user_id,
         count(p.id)::integer,
         max(p.created_at),
         (count(p.id) filter (where coalesce(p.prefs->>'messages', 'true') = 'false'))::integer,
         coalesce(array_agg(distinct case
           when p.ua ~* '(iphone|ipad|ipod)' then 'iPhone ou iPad'
           when p.ua ~* 'android' then 'Android'
           when p.ua ~* 'macintosh' then 'Mac (ou iPad)'
           when p.ua is not null then 'Ordinateur' end) filter (where p.id is not null), '{}')
  from public.members m
  left join public.push_abonnements p on p.user_id = m.user_id
  where m.cabinet_id = p_cabinet and public.is_member(p_cabinet)
  group by m.user_id;
$$;
revoke all on function public.push_etat_equipe(uuid) from public, anon;
grant execute on function public.push_etat_equipe(uuid) to authenticated;
