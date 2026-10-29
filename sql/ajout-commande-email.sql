-- SimSimStock · Commande envoyée au fournisseur en un clic
-- 1) le carnet d'adresses des fournisseurs de chaque cabinet (e-mail du commercial, copie, n° client)
-- 2) l'historique des commandes envoyées par e-mail (écrit seulement par la fonction « envoyer-commande »)
-- À lancer une fois dans Supabase : SQL Editor → New query → coller → Run. Peut être relancé sans risque.

create table if not exists public.fournisseurs_contacts (
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  fournisseur text not null,
  email text not null default '',
  cc text not null default '',
  client_no text not null default '',
  contact text not null default '',
  maj_par text not null default '',
  updated_at timestamptz not null default now(),
  primary key (cabinet_id, fournisseur),
  constraint fournisseurs_contacts_email check (email = '' or email ~* '^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$'),
  constraint fournisseurs_contacts_tailles check (length(fournisseur) <= 120 and length(cc) <= 300 and length(client_no) <= 60 and length(contact) <= 120)
);
alter table public.fournisseurs_contacts enable row level security;
drop policy if exists fc_lecture on public.fournisseurs_contacts;
drop policy if exists fc_ecriture on public.fournisseurs_contacts;
drop policy if exists fc_modif on public.fournisseurs_contacts;
drop policy if exists fc_suppr on public.fournisseurs_contacts;
create policy fc_lecture on public.fournisseurs_contacts for select to authenticated using (public.is_member(cabinet_id));
create policy fc_ecriture on public.fournisseurs_contacts for insert to authenticated with check (public.is_writer(cabinet_id));
create policy fc_modif on public.fournisseurs_contacts for update to authenticated using (public.is_writer(cabinet_id)) with check (public.is_writer(cabinet_id));
create policy fc_suppr on public.fournisseurs_contacts for delete to authenticated using (public.is_writer(cabinet_id));

create table if not exists public.commandes_envoyees (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  fournisseur text not null,
  destinataire text not null,
  copie text not null default '',
  nb_lignes int not null default 0,
  total_ht numeric,
  lignes jsonb not null default '[]'::jsonb,
  message text not null default '',
  par text not null default '',
  par_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists commandes_envoyees_cab on public.commandes_envoyees (cabinet_id, created_at desc);
alter table public.commandes_envoyees enable row level security;
drop policy if exists ce_lecture on public.commandes_envoyees;
create policy ce_lecture on public.commandes_envoyees for select to authenticated using (public.is_member(cabinet_id));
-- pas de droit d'écriture pour l'appli : seule la fonction d'envoi (clé serveur) ajoute une ligne, après l'envoi réel de l'e-mail
