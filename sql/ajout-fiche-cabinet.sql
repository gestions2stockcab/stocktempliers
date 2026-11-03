-- SimSimStock · fiche du cabinet (adresse, praticiens, tarifs, médiateur…) qui pré-remplit les affiches obligatoires
-- À lancer une fois dans Supabase : SQL Editor → New query → coller → Run. Peut être relancé sans risque.

create table if not exists public.cabinet_fiche (
  cabinet_id uuid primary key references public.cabinets(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  maj_par text not null default '',
  updated_at timestamptz not null default now(),
  constraint cabinet_fiche_taille check (pg_column_size(data) < 60000)
);

-- qui a modifié et quand
create or replace function public.cabinet_fiche_maj() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.maj_par := coalesce((select email from auth.users where id = auth.uid()), '');
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists cabinet_fiche_signer on public.cabinet_fiche;
create trigger cabinet_fiche_signer before insert or update on public.cabinet_fiche for each row execute function public.cabinet_fiche_maj();

alter table public.cabinet_fiche enable row level security;
drop policy if exists fiche_lecture on public.cabinet_fiche;
drop policy if exists fiche_ajout on public.cabinet_fiche;
drop policy if exists fiche_modif on public.cabinet_fiche;
create policy fiche_lecture on public.cabinet_fiche for select to authenticated using (public.is_member(cabinet_id));
create policy fiche_ajout on public.cabinet_fiche for insert to authenticated with check (public.is_writer(cabinet_id));
create policy fiche_modif on public.cabinet_fiche for update to authenticated using (public.is_writer(cabinet_id)) with check (public.is_writer(cabinet_id));
