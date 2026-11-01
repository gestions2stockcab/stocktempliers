-- SimSimStock · statuts de l'équipe : Dentiste, Assistante, Assistante référente, Dentiste référente
-- « Dentiste référente » reprend l'ancien « Big boss » (valeur bigboss, une seule par cabinet) ;
-- « Assistante référente » est une nouvelle valeur : assistante_ref.
-- À lancer une fois dans Supabase : SQL Editor → New query → coller → Run. Peut être relancé sans risque.

do $$
declare c record;
begin
  -- on retire l'ancienne liste de valeurs autorisées (quel que soit son nom), puis on remet la nouvelle
  for c in
    select con.conname
    from pg_constraint con
    join pg_class t on t.oid = con.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'equipe_profils' and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%profil%'
  loop
    execute format('alter table public.equipe_profils drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.equipe_profils
  add constraint equipe_profils_profil_valeurs
  check (profil in ('dentiste', 'assistante', 'assistante_ref', 'bigboss'));
