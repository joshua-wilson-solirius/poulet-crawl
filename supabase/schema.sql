-- Où est le Poulet: Supabase setup.
-- Paste this whole file into Supabase → SQL Editor → New query → Run. Safe to run again.
-- Then add organisers at the bottom (edit the emails) and run that part.

-- ---------------------------------------------------------------
-- 1. Game data: one table of JSON documents keyed by path.
--    content/*   teams, challenges, pub info, settings   (organisers write, everyone reads)
--    secret/*    hideout + clue list                     (organisers only)
--    unlocked/*  clues each team has unlocked            (organisers write, everyone reads)
--    found/*     teams that found the chicken            (organisers write, everyone reads)
--    visits/*    pub check-ins                           (anyone writes)
--    subs/*      challenge evidence                      (anyone writes)
-- ---------------------------------------------------------------
create table if not exists public.docs (
  path        text primary key check (path ~ '^[a-z]+/[A-Za-z0-9_.:@+~-]+$'),
  body        jsonb not null,
  updated_at  timestamptz not null default now()
);

create table if not exists public.admins (
  email text primary key
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
grant execute on function public.is_admin() to anon, authenticated;

create or replace function public.player_path(p text) returns boolean
language sql immutable as $$ select p like 'visits/%' or p like 'subs/%' $$;

alter table public.docs   enable row level security;
alter table public.admins enable row level security;

drop policy if exists docs_read   on public.docs;
drop policy if exists docs_insert on public.docs;
drop policy if exists docs_update on public.docs;
drop policy if exists docs_delete on public.docs;
create policy docs_read   on public.docs for select to anon, authenticated using (path not like 'secret/%' or public.is_admin());
create policy docs_insert on public.docs for insert to anon, authenticated with check (public.player_path(path) or public.is_admin());
create policy docs_update on public.docs for update to anon, authenticated using (public.player_path(path) or public.is_admin()) with check (public.player_path(path) or public.is_admin());
create policy docs_delete on public.docs for delete to anon, authenticated using (public.player_path(path) or public.is_admin());

drop policy if exists admins_read  on public.admins;
drop policy if exists admins_write on public.admins;
create policy admins_read  on public.admins for select to authenticated using (public.is_admin());
create policy admins_write on public.admins for all    to authenticated using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.docs to anon, authenticated;
grant select, insert, delete on public.admins to authenticated;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before update on public.docs for each row execute function public.touch_updated_at();

-- Live updates to every open phone.
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------
-- 2. Evidence photos and videos (public links, 20 MB max each).
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence', 'evidence', true, 20971520, array['image/*', 'video/*'])
on conflict (id) do update set public = true, file_size_limit = 20971520, allowed_mime_types = array['image/*', 'video/*'];

drop policy if exists evidence_upload on storage.objects;
drop policy if exists evidence_delete on storage.objects;
create policy evidence_upload on storage.objects for insert to anon, authenticated with check (bucket_id = 'evidence');
create policy evidence_delete on storage.objects for delete to authenticated using (bucket_id = 'evidence' and public.is_admin());

-- ---------------------------------------------------------------
-- 3. Organisers: put your email and Dom's here, then run this part.
--    These people can sign in (magic link) and see Chicken HQ.
-- ---------------------------------------------------------------
-- insert into public.admins (email) values ('you@example.com'), ('dom@example.com') on conflict do nothing;
