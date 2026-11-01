-- SimSimStock · suivi des travaux de laboratoire (prothèses et dispositifs sur mesure)
-- Envoi au labo, retour prévu, réception, déclaration de conformité, pose : avec le patient concerné.
-- À lancer une fois dans Supabase : SQL Editor → New query → coller → Run. Peut être relancé sans risque.
-- Prérequis : le script « ajout-qualite » (fonctions qualite_role et qualite_signer).
-- Les données patient ne sont visibles que des administrateurs et membres du cabinet (pas des comptes « lecture seule »).

create table if not exists public.labo_travaux (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  patient_nom text not null,
  patient_dossier text not null default '',
  praticien text not null default '',
  travail text not null,
  dents text not null default '',
  teinte text not null default '',
  labo text not null default '',
  envoye_le date not null default current_date,
  retour_prevu date,
  recu_le date,
  conformite boolean not null default false,
  pose_le date,
  statut text not null default 'envoye',
  note text not null default '',
  par text not null default '',
  par_id uuid,
  maj_par text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint labo_statut check (statut in ('envoye', 'recu', 'pose', 'annule')),
  constraint labo_tailles check (length(patient_nom) between 2 and 120 and length(travail) between 2 and 120 and length(note) <= 1000 and length(labo) <= 120)
);
create index if not exists labo_travaux_cab on public.labo_travaux (cabinet_id, statut, retour_prevu);

-- à chaque modification : qui et quand ; la signature de création ne peut pas être changée
create or replace function public.labo_maj() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.par := old.par; new.par_id := old.par_id; new.created_at := old.created_at; new.cabinet_id := old.cabinet_id;
  new.maj_par := coalesce((select email from auth.users where id = auth.uid()), '');
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists labo_travaux_signer on public.labo_travaux;
create trigger labo_travaux_signer before insert on public.labo_travaux for each row execute function public.qualite_signer();
drop trigger if exists labo_travaux_maj on public.labo_travaux;
create trigger labo_travaux_maj before update on public.labo_travaux for each row execute function public.labo_maj();

alter table public.labo_travaux enable row level security;
drop policy if exists labo_lecture on public.labo_travaux;
drop policy if exists labo_ajout on public.labo_travaux;
drop policy if exists labo_modif on public.labo_travaux;
create policy labo_lecture on public.labo_travaux for select to authenticated using (public.qualite_role(cabinet_id) in ('admin', 'member'));
create policy labo_ajout on public.labo_travaux for insert to authenticated with check (public.qualite_role(cabinet_id) in ('admin', 'member'));
create policy labo_modif on public.labo_travaux for update to authenticated using (public.qualite_role(cabinet_id) in ('admin', 'member')) with check (public.qualite_role(cabinet_id) in ('admin', 'member'));
-- pas de suppression : un travail se passe au statut « annulé »
