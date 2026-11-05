-- SimSimStock · réactions sur les messages (👍 👎 ❤️ 😂 😮 😢 😠) : une réaction par personne et par message
-- À lancer une fois dans Supabase : SQL Editor → New query → coller → Run. Peut être relancé sans risque.
-- Prérequis : la messagerie (script « ajout-messages »).

create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id),
  constraint reactions_emoji check (emoji in ('👍', '👎', '❤️', '😂', '😮', '😢', '😠'))
);
create index if not exists message_reactions_cab on public.message_reactions (cabinet_id);
-- pour que la suppression d'une réaction soit transmise en direct avec le cabinet concerné
alter table public.message_reactions replica identity full;

alter table public.message_reactions enable row level security;
drop policy if exists reactions_lecture on public.message_reactions;
drop policy if exists reactions_ajout on public.message_reactions;
drop policy if exists reactions_modif on public.message_reactions;
drop policy if exists reactions_suppr on public.message_reactions;
-- on voit les réactions des messages qu'on a le droit de lire (messages d'équipe, ou messages privés où l'on est l'un des deux)
create policy reactions_lecture on public.message_reactions for select to authenticated
  using (public.is_member(cabinet_id) and exists (select 1 from public.messages m where m.id = message_id and m.cabinet_id = message_reactions.cabinet_id));
create policy reactions_ajout on public.message_reactions for insert to authenticated
  with check (user_id = auth.uid() and public.is_member(cabinet_id) and exists (select 1 from public.messages m where m.id = message_id and m.cabinet_id = message_reactions.cabinet_id));
create policy reactions_modif on public.message_reactions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member(cabinet_id) and exists (select 1 from public.messages m where m.id = message_id and m.cabinet_id = message_reactions.cabinet_id));
create policy reactions_suppr on public.message_reactions for delete to authenticated using (user_id = auth.uid());

do $$ begin
  begin alter publication supabase_realtime add table public.message_reactions; exception when others then null; end;
end $$;
