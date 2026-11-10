-- SimSimStock · heures supplémentaires de l'équipe
-- Chaque personne déclare ses heures sup ; un administrateur du cabinet les valide ou les refuse.
-- À lancer une fois dans Supabase : SQL Editor → New query → coller → Run. Peut être relancé sans risque.

create table if not exists public.heures_sup (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  jour date not null default current_date,
  minutes integer not null,
  motif text not null default '',
  note text not null default '',
  statut text not null default 'en_attente',
  valide_par text not null default '',
  valide_le timestamptz,
  created_at timestamptz not null default now(),
  constraint heures_sup_minutes check (minutes between 1 and 1440),
  constraint heures_sup_statut check (statut in ('en_attente', 'validee', 'refusee')),
  constraint heures_sup_tailles check (length(motif) <= 80 and length(note) <= 300)
);
create index if not exists heures_sup_cab on public.heures_sup (cabinet_id, jour desc);
-- v192 : un administrateur peut saisir pour une autre personne de l'équipe, ou pour quelqu'un sans compte (nom écrit)
alter table public.heures_sup add column if not exists nom text not null default '';
alter table public.heures_sup alter column user_id drop not null;
alter table public.heures_sup drop constraint if exists heures_sup_personne;
alter table public.heures_sup add constraint heures_sup_personne check (user_id is not null or length(trim(nom)) between 2 and 60);

-- administrateur du cabinet ?
create or replace function public.hs_admin(p_cabinet uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.members where cabinet_id = p_cabinet and user_id = auth.uid() and role = 'admin');
$$;

-- seul un administrateur peut valider ou refuser ; la validation est signée (qui, quand)
create or replace function public.heures_sup_controle() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    if public.hs_admin(new.cabinet_id) then
      -- saisie par un administrateur : pour lui-même, pour un membre du cabinet, ou pour une personne sans compte ; validée d'office
      if new.user_id is not null and not exists (select 1 from public.members where cabinet_id = new.cabinet_id and user_id = new.user_id) then raise exception 'personne_inconnue'; end if;
      if new.user_id is null and coalesce(trim(new.nom), '') = '' then new.user_id := auth.uid(); end if;
      if new.user_id is not null then new.nom := ''; end if;
      new.statut := 'validee'; new.valide_par := coalesce((select email from auth.users where id = auth.uid()), ''); new.valide_le := now();
    else
      new.user_id := auth.uid(); new.nom := ''; new.statut := 'en_attente'; new.valide_par := ''; new.valide_le := null;
    end if;
    return new;
  end if;
  new.cabinet_id := old.cabinet_id; new.user_id := old.user_id; new.nom := old.nom; new.created_at := old.created_at;
  if new.statut is distinct from old.statut then
    if not public.hs_admin(old.cabinet_id) then raise exception 'validation_reservee'; end if;
    new.valide_par := coalesce((select email from auth.users where id = auth.uid()), '');
    new.valide_le := case when new.statut = 'en_attente' then null else now() end;
  end if;
  return new;
end $$;
drop trigger if exists heures_sup_signer on public.heures_sup;
create trigger heures_sup_signer before insert or update on public.heures_sup for each row execute function public.heures_sup_controle();

alter table public.heures_sup enable row level security;
drop policy if exists hs_lecture on public.heures_sup;
drop policy if exists hs_ajout on public.heures_sup;
drop policy if exists hs_modif on public.heures_sup;
drop policy if exists hs_suppr on public.heures_sup;
-- chacun voit ses heures ; les administrateurs voient celles de toute l'équipe
create policy hs_lecture on public.heures_sup for select to authenticated using (user_id = auth.uid() or public.hs_admin(cabinet_id));
create policy hs_ajout on public.heures_sup for insert to authenticated with check (public.is_member(cabinet_id));
create policy hs_modif on public.heures_sup for update to authenticated
  using ((user_id = auth.uid() and statut = 'en_attente') or public.hs_admin(cabinet_id))
  with check ((user_id = auth.uid() and statut = 'en_attente') or public.hs_admin(cabinet_id));
create policy hs_suppr on public.heures_sup for delete to authenticated
  using ((user_id = auth.uid() and statut = 'en_attente') or public.hs_admin(cabinet_id));
