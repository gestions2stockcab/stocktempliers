-- SimSimStock : espace « Qualité et traçabilité » (v140)
-- Implants posés, ouvertures de sachets stérilisés, affichages obligatoires et leurs vérifications.
-- À lancer une fois dans Supabase → SQL Editor → New query → coller → Run. Peut être relancé sans risque.
--
-- Principes :
--  - chaque enregistrement est signé automatiquement (par / par_id / created_at posés par la base) ;
--  - rien ne se supprime : une erreur s'annule avec un motif, et l'annulation est signée elle aussi ;
--  - les données patient (implants, sachets) ne sont visibles que des administrateurs et membres
--    du cabinet, jamais des comptes « lecture seule ».

-- rôle de la personne connectée dans un cabinet ('admin', 'member', 'viewer' ou null)
create or replace function public.qualite_role(p_cabinet uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from public.members where cabinet_id = p_cabinet and user_id = auth.uid() limit 1
$$;
revoke all on function public.qualite_role(uuid) from public, anon;
grant execute on function public.qualite_role(uuid) to authenticated;

-- signature à la création : impossible à falsifier depuis l'appli
create or replace function public.qualite_signer() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.par_id := auth.uid();
  new.par := coalesce((select email from auth.users where id = auth.uid()), '');
  new.created_at := now();
  return new;
end $$;

-- seule l'annulation (avec motif) est permise après coup ; elle est signée à son tour
create or replace function public.qualite_annulation_seule() returns trigger
language plpgsql security definer set search_path = public as $$
declare champs text[] := array['annule', 'annule_motif', 'annule_par', 'annule_le'];
begin
  if old.annule then raise exception 'deja_annule'; end if;
  if (to_jsonb(new) - champs) is distinct from (to_jsonb(old) - champs) then raise exception 'modification_interdite'; end if;
  if not new.annule then raise exception 'modification_interdite'; end if;
  if length(trim(coalesce(new.annule_motif, ''))) < 3 then raise exception 'motif_obligatoire'; end if;
  new.annule_par := coalesce((select email from auth.users where id = auth.uid()), '');
  new.annule_le := now();
  return new;
end $$;

-- 1. implants et dispositifs implantables posés
create table if not exists public.implants_poses (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  pose_le date not null default current_date,
  patient_nom text not null check (length(trim(patient_nom)) > 0),
  patient_dossier text not null default '',
  praticien text not null default '',
  localisation text not null default '',
  produit text not null check (length(trim(produit)) > 0),
  fabricant text not null default '',
  ref text not null default '',
  lot text not null check (length(trim(lot)) > 0),
  serie text not null default '',
  peremption date,
  gtin text not null default '',
  code_brut text not null default '',
  item_id uuid references public.items(id) on delete set null,
  quantite numeric not null default 1 check (quantite > 0),
  note text not null default '',
  annule boolean not null default false,
  annule_motif text not null default '',
  annule_par text not null default '',
  annule_le timestamptz,
  par_id uuid,
  par text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists implants_poses_lot on public.implants_poses (cabinet_id, lower(lot));
create index if not exists implants_poses_date on public.implants_poses (cabinet_id, pose_le desc);

-- 2. sachets stérilisés ouverts pour un patient (relie le cycle d'autoclave au soin)
create table if not exists public.sachets_ouvertures (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  cycle_id uuid references public.sterilisation_registre(id) on delete set null,
  cycle_numero text not null default '',
  cycle_le timestamptz,
  appareil text not null default '',
  contenu text not null default '',
  patient_nom text not null check (length(trim(patient_nom)) > 0),
  patient_dossier text not null default '',
  soin text not null default '',
  salle text not null default '',
  ouvert_le timestamptz not null default now(),
  annule boolean not null default false,
  annule_motif text not null default '',
  annule_par text not null default '',
  annule_le timestamptz,
  par_id uuid,
  par text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists sachets_ouvertures_cycle on public.sachets_ouvertures (cabinet_id, cycle_id);
create index if not exists sachets_ouvertures_date on public.sachets_ouvertures (cabinet_id, ouvert_le desc);

-- 3. affichages et documents obligatoires, et l'historique de leurs vérifications
create table if not exists public.affichages (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  titre text not null check (length(trim(titre)) > 0),
  categorie text not null default '',
  detail text not null default '',
  frequence_mois integer not null default 12 check (frequence_mois >= 0 and frequence_mois <= 120),
  derniere_verif date,
  archived boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.affichages_verifs (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  affichage_id uuid not null references public.affichages(id) on delete cascade,
  verifie_le date not null default current_date,
  ok boolean not null default true,
  note text not null default '',
  par_id uuid,
  par text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists affichages_verifs_aff on public.affichages_verifs (affichage_id, verifie_le desc);

-- une vérification conforme met à jour la date de dernière vérification
create or replace function public.affichages_apres_verif() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.ok then
    update public.affichages set derniere_verif = greatest(coalesce(derniere_verif, new.verifie_le), new.verifie_le) where id = new.affichage_id;
  end if;
  return new;
end $$;

-- déclencheurs
drop trigger if exists implants_poses_signer on public.implants_poses;
create trigger implants_poses_signer before insert on public.implants_poses for each row execute function public.qualite_signer();
drop trigger if exists implants_poses_proteger on public.implants_poses;
create trigger implants_poses_proteger before update on public.implants_poses for each row execute function public.qualite_annulation_seule();
drop trigger if exists sachets_ouvertures_signer on public.sachets_ouvertures;
create trigger sachets_ouvertures_signer before insert on public.sachets_ouvertures for each row execute function public.qualite_signer();
drop trigger if exists sachets_ouvertures_proteger on public.sachets_ouvertures;
create trigger sachets_ouvertures_proteger before update on public.sachets_ouvertures for each row execute function public.qualite_annulation_seule();
drop trigger if exists affichages_verifs_signer on public.affichages_verifs;
create trigger affichages_verifs_signer before insert on public.affichages_verifs for each row execute function public.qualite_signer();
drop trigger if exists affichages_verifs_maj on public.affichages_verifs;
create trigger affichages_verifs_maj after insert on public.affichages_verifs for each row execute function public.affichages_apres_verif();

-- droits : RLS, aucun accès anonyme, aucune suppression des registres
alter table public.implants_poses enable row level security;
alter table public.sachets_ouvertures enable row level security;
alter table public.affichages enable row level security;
alter table public.affichages_verifs enable row level security;
revoke all on public.implants_poses, public.sachets_ouvertures, public.affichages, public.affichages_verifs from anon;
revoke delete, truncate on public.implants_poses, public.sachets_ouvertures, public.affichages_verifs from authenticated;
revoke truncate on public.affichages from authenticated;

drop policy if exists implants_lecture on public.implants_poses;
drop policy if exists implants_ajout on public.implants_poses;
drop policy if exists implants_annulation on public.implants_poses;
create policy implants_lecture on public.implants_poses for select to authenticated using (public.qualite_role(cabinet_id) in ('admin', 'member'));
create policy implants_ajout on public.implants_poses for insert to authenticated with check (public.qualite_role(cabinet_id) in ('admin', 'member'));
create policy implants_annulation on public.implants_poses for update to authenticated using (public.qualite_role(cabinet_id) in ('admin', 'member')) with check (public.qualite_role(cabinet_id) in ('admin', 'member'));

drop policy if exists sachets_lecture on public.sachets_ouvertures;
drop policy if exists sachets_ajout on public.sachets_ouvertures;
drop policy if exists sachets_annulation on public.sachets_ouvertures;
create policy sachets_lecture on public.sachets_ouvertures for select to authenticated using (public.qualite_role(cabinet_id) in ('admin', 'member'));
create policy sachets_ajout on public.sachets_ouvertures for insert to authenticated with check (public.qualite_role(cabinet_id) in ('admin', 'member'));
create policy sachets_annulation on public.sachets_ouvertures for update to authenticated using (public.qualite_role(cabinet_id) in ('admin', 'member')) with check (public.qualite_role(cabinet_id) in ('admin', 'member'));

drop policy if exists affichages_lecture on public.affichages;
drop policy if exists affichages_ajout on public.affichages;
drop policy if exists affichages_modif on public.affichages;
drop policy if exists affichages_suppression on public.affichages;
create policy affichages_lecture on public.affichages for select to authenticated using (public.qualite_role(cabinet_id) is not null);
create policy affichages_ajout on public.affichages for insert to authenticated with check (public.qualite_role(cabinet_id) in ('admin', 'member'));
create policy affichages_modif on public.affichages for update to authenticated using (public.qualite_role(cabinet_id) in ('admin', 'member')) with check (public.qualite_role(cabinet_id) in ('admin', 'member'));
create policy affichages_suppression on public.affichages for delete to authenticated using (public.qualite_role(cabinet_id) = 'admin');

drop policy if exists verifs_lecture on public.affichages_verifs;
drop policy if exists verifs_ajout on public.affichages_verifs;
create policy verifs_lecture on public.affichages_verifs for select to authenticated using (public.qualite_role(cabinet_id) is not null);
create policy verifs_ajout on public.affichages_verifs for insert to authenticated with check (public.qualite_role(cabinet_id) in ('admin', 'member'));

-- mises à jour en direct dans l'appli
do $$ begin
  begin alter publication supabase_realtime add table public.implants_poses; exception when others then null; end;
  begin alter publication supabase_realtime add table public.sachets_ouvertures; exception when others then null; end;
  begin alter publication supabase_realtime add table public.affichages; exception when others then null; end;
  begin alter publication supabase_realtime add table public.affichages_verifs; exception when others then null; end;
end $$;

select 'Qualité et traçabilité installées.' as resultat;
