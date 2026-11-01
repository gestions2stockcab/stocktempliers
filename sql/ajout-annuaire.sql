-- SimSimStock · annuaire du cabinet (labos, commerciaux, techniciens, urgences…)
-- À lancer une fois dans Supabase : SQL Editor → New query → coller → Run. Peut être relancé sans risque.

create table if not exists public.contacts_cabinet (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  nom text not null,
  categorie text not null default 'autre',
  societe text not null default '',
  telephone text not null default '',
  email text not null default '',
  note text not null default '',
  maj_par text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contacts_categorie check (categorie in ('labo', 'fournisseur', 'maintenance', 'urgence', 'administratif', 'autre')),
  constraint contacts_tailles check (length(nom) between 1 and 120 and length(societe) <= 120 and length(telephone) <= 40 and length(email) <= 160 and length(note) <= 500)
);
create index if not exists contacts_cabinet_cab on public.contacts_cabinet (cabinet_id, categorie, nom);
alter table public.contacts_cabinet enable row level security;
drop policy if exists cc_lecture on public.contacts_cabinet;
drop policy if exists cc_ajout on public.contacts_cabinet;
drop policy if exists cc_modif on public.contacts_cabinet;
drop policy if exists cc_suppr on public.contacts_cabinet;
create policy cc_lecture on public.contacts_cabinet for select to authenticated using (public.is_member(cabinet_id));
create policy cc_ajout on public.contacts_cabinet for insert to authenticated with check (public.is_writer(cabinet_id));
create policy cc_modif on public.contacts_cabinet for update to authenticated using (public.is_writer(cabinet_id)) with check (public.is_writer(cabinet_id));
create policy cc_suppr on public.contacts_cabinet for delete to authenticated using (public.is_writer(cabinet_id));
