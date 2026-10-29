-- SimSimStock · « Statistiques » de l'Administration (réservé au propriétaire)
-- Rassemble, pour chaque cabinet, l'activité et l'usage de chaque fonction, plus les comptes et l'activité des 30 derniers jours.
-- À lancer une fois dans Supabase : SQL Editor → New query → coller → Run. Peut être relancé sans risque.

create or replace function public.admin_stats()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  res json;
begin
  if not public.est_proprietaire() then
    raise exception 'forbidden';
  end if;

  with cab as (select id, name, created_at from cabinets),
  per as (
    select c.id, c.name, c.created_at,
      (select count(*) from members m where m.cabinet_id = c.id) as membres,
      (select count(*) from members m where m.cabinet_id = c.id and m.role = 'admin') as admins,
      (select count(*) from items i where i.cabinet_id = c.id and not coalesce(i.archived, false)) as articles,
      (select count(*) from items i where i.cabinet_id = c.id and not coalesce(i.archived, false) and coalesce(i.tracked, true)) as articles_suivis,
      (select count(*) from items i where i.cabinet_id = c.id and not coalesce(i.archived, false) and coalesce(i.tracked, true) and coalesce(i.qty, 0) <= 0) as ruptures,
      (select count(*) from items i where i.cabinet_id = c.id and not coalesce(i.archived, false) and coalesce(i.tracked, true) and coalesce(i.qty, 0) > 0 and coalesce(i.qty, 0) <= coalesce(i.min, 0)) as sous_seuil,
      (select round(coalesce(sum(greatest(coalesce(i.qty, 0), 0) * coalesce(i.price, 0)), 0)::numeric, 2) from items i where i.cabinet_id = c.id and not coalesce(i.archived, false)) as valeur_stock_ht,
      (select count(*) from items i where i.cabinet_id = c.id and coalesce(i.price, 0) > 0 and not coalesce(i.archived, false)) as articles_avec_prix,
      (select count(*) from items i where i.cabinet_id = c.id and coalesce(i.barcode, '') <> '' and not coalesce(i.archived, false)) as articles_avec_code,
      (select count(*) from items i where i.cabinet_id = c.id and coalesce(i.location, '') <> '' and not coalesce(i.archived, false)) as articles_avec_tiroir,
      (select count(*) from movements v where v.cabinet_id = c.id) as mouvements_total,
      (select count(*) from movements v where v.cabinet_id = c.id and v.created_at > now() - interval '7 days') as mouvements_7j,
      (select count(*) from movements v where v.cabinet_id = c.id and v.created_at > now() - interval '30 days') as mouvements_30j,
      (select max(v.created_at) from movements v where v.cabinet_id = c.id) as dernier_mouvement,
      (select count(distinct v.user_email) from movements v where v.cabinet_id = c.id and v.created_at > now() - interval '30 days') as personnes_actives_30j,
      (select count(*) from movements v where v.cabinet_id = c.id and v.type = 'count' and v.item like 'Inventaire tiroir · %') as inventaires_tiroir,
      (select count(*) from messages g where g.cabinet_id = c.id and g.created_at > now() - interval '30 days') as messages_30j,
      (select count(*) from messages g where g.cabinet_id = c.id and g.kind = 'tache') as taches_total,
      (select max(g.created_at) from messages g where g.cabinet_id = c.id) as dernier_message,
      (select count(*) from sterilisation_registre s where s.cabinet_id = c.id and s.fait_at > now() - interval '30 days') as steril_30j,
      (select max(s.fait_at) from sterilisation_registre s where s.cabinet_id = c.id) as derniere_steril,
      (select count(*) from implants_poses p where p.cabinet_id = c.id and not coalesce(p.annule, false)) as implants_total,
      (select count(*) from sachets_ouvertures o where o.cabinet_id = c.id) as sachets_ouverts,
      (select count(*) from affichages a where a.cabinet_id = c.id) as affichages,
      (select count(*) from affichages_verifs a where a.cabinet_id = c.id) as affichages_verifs,
      (select count(*) from imported_docs d where d.cabinet_id = c.id) as factures,
      (select max(d.created_at) from imported_docs d where d.cabinet_id = c.id) as derniere_facture,
      (select round(coalesce(sum(case when l.doc_type = 'avoir' then -1 else 1 end * coalesce(l.total_ht, 0)), 0)::numeric, 2) from achat_lignes l where l.cabinet_id = c.id and l.doc_date > current_date - 365) as achats_12m_ht,
      (select count(*) from equipements e where e.cabinet_id = c.id and not coalesce(e.archived, false)) as equipements,
      (select count(*) from contrats t where t.cabinet_id = c.id) as contrats,
      (select count(*) from salles r where r.cabinet_id = c.id) as salles,
      (select count(*) from controles k where k.cabinet_id = c.id) as controles,
      (select max(k.done_at) from controle_logs k where k.cabinet_id = c.id) as dernier_controle,
      (select count(*) from kits k where k.cabinet_id = c.id) as kits,
      (select count(*) from routines r where r.cabinet_id = c.id) as routines,
      (select max(r.at) from routine_coches r where r.cabinet_id = c.id) as derniere_routine,
      (select max(b.created_at) from sauvegardes b where b.cabinet_id = c.id) as derniere_sauvegarde,
      (select count(*) from invitations n where n.cabinet_id = c.id and n.accepted_at is null) as invitations_attente,
      (select count(*) from push_abonnements a join members m on m.user_id = a.user_id and m.cabinet_id = c.id) as appareils_notifies,
      (select count(*) from storage.objects so where so.bucket_id = 'docs' and split_part(so.name, '/', 1) = c.id::text) as fichiers,
      (select coalesce(sum((so.metadata->>'size')::bigint), 0) from storage.objects so where so.bucket_id = 'docs' and split_part(so.name, '/', 1) = c.id::text) as fichiers_octets,
      (select count(*) from storage.objects so where so.bucket_id = 'docs' and so.name like c.id::text || '/inventaires/%') as photos_tiroirs,
      (select max(u.last_sign_in_at) from members m join auth.users u on u.id = m.user_id where m.cabinet_id = c.id) as derniere_connexion,
      (select max(w.vu_at) from derniere_vue w where w.cabinet_id = c.id) as derniere_vue,
      (select json_agg(json_build_object('espace', x.espace, 'vues', x.n) order by x.n desc) from (select coalesce(nullif(w.espace, ''), '?') as espace, count(*) as n from derniere_vue w where w.cabinet_id = c.id group by 1) x) as espaces,
      (select json_agg(json_build_object('appareil', x.appareil, 'n', x.n) order by x.n desc) from (select coalesce(nullif(w.appareil, ''), '?') as appareil, count(*) as n from derniere_vue w where w.cabinet_id = c.id group by 1) x) as appareils
    from cab c
  )
  select json_build_object(
    'genere_le', now(),
    'cabinets', (select coalesce(json_agg(row_to_json(p) order by p.name), '[]'::json) from per p),
    'utilisateurs', (select coalesce(json_agg(json_build_object(
        'id', u.id, 'email', u.email, 'cree_le', u.created_at, 'derniere_connexion', u.last_sign_in_at,
        'cabinets', (select coalesce(json_agg(json_build_object('cabinet', c.name, 'role', m.role)), '[]'::json) from members m join cabinets c on c.id = m.cabinet_id where m.user_id = u.id),
        'derniere_vue', (select max(w.vu_at) from derniere_vue w where w.user_id = u.id),
        'appareil', (select w.appareil from derniere_vue w where w.user_id = u.id order by w.vu_at desc nulls last limit 1),
        'mouvements_30j', (select count(*) from movements v where v.user_email = u.email and v.created_at > now() - interval '30 days'),
        'notifications', (select count(*) from push_abonnements a where a.user_id = u.id),
        'double_auth', exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified')
      ) order by u.last_sign_in_at desc nulls last), '[]'::json) from auth.users u),
    'jours', (select coalesce(json_agg(json_build_object('jour', d.jour, 'mouvements', d.mv, 'cabinets_actifs', d.cab, 'messages', d.msg) order by d.jour), '[]'::json) from (
        select g.jour::date as jour,
          (select count(*) from movements v where v.created_at::date = g.jour::date) as mv,
          (select count(*) from messages m where m.created_at::date = g.jour::date) as msg,
          (select count(distinct x.cid) from (
              select v.cabinet_id as cid from movements v where v.created_at::date = g.jour::date
              union select m.cabinet_id from messages m where m.created_at::date = g.jour::date
              union select s.cabinet_id from sterilisation_registre s where s.fait_at::date = g.jour::date
              union select w.cabinet_id from derniere_vue w where w.vu_at::date = g.jour::date) x) as cab
        from generate_series(current_date - 29, current_date, interval '1 day') g(jour)) d)
  ) into res;
  return res;
end;
$$;

revoke all on function public.admin_stats() from public, anon;
grant execute on function public.admin_stats() to authenticated;
